package observability

import (
	"bufio"
	"errors"
	"math"
	"net"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

type Metrics struct {
	Requests uint64 `json:"requests"`
	Errors   uint64 `json:"errors"`

	mu        sync.Mutex
	endpoints map[string]*endpointMetrics
}

type endpointMetrics struct {
	Requests    uint64
	Errors      uint64
	DurationsMS []float64
}

type SnapshotData struct {
	Requests  uint64                      `json:"requests"`
	Errors    uint64                      `json:"errors"`
	Endpoints map[string]EndpointSnapshot `json:"endpoints"`
}

type EndpointSnapshot struct {
	Requests uint64  `json:"requests"`
	Errors   uint64  `json:"errors"`
	P50MS    float64 `json:"duration_p50_ms"`
	P95MS    float64 `json:"duration_p95_ms"`
	P99MS    float64 `json:"duration_p99_ms"`
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func RequestLogger(logger *zap.Logger, metrics *Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(recorder, r)
			duration := time.Since(started)
			atomic.AddUint64(&metrics.Requests, 1)
			if recorder.status >= 500 {
				atomic.AddUint64(&metrics.Errors, 1)
			}
			metrics.record(r.Method+" "+r.URL.Path, recorder.status, duration)
			logger.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", recorder.status),
				zap.Duration("duration", duration),
			)
		})
	}
}

func (m *Metrics) record(endpoint string, status int, duration time.Duration) {
	m.mu.Lock()
	if m.endpoints == nil {
		m.endpoints = map[string]*endpointMetrics{}
	}
	current := m.endpoints[endpoint]
	if current == nil {
		current = &endpointMetrics{}
		m.endpoints[endpoint] = current
	}
	current.Requests++
	if status >= 500 {
		current.Errors++
	}
	current.DurationsMS = append(current.DurationsMS, float64(duration.Microseconds())/1000)
	if len(current.DurationsMS) > 1024 {
		current.DurationsMS = current.DurationsMS[len(current.DurationsMS)-1024:]
	}
	m.mu.Unlock()
}

func Snapshot(metrics *Metrics) SnapshotData {
	out := SnapshotData{
		Requests:  atomic.LoadUint64(&metrics.Requests),
		Errors:    atomic.LoadUint64(&metrics.Errors),
		Endpoints: map[string]EndpointSnapshot{},
	}
	metrics.mu.Lock()
	defer metrics.mu.Unlock()
	for endpoint, values := range metrics.endpoints {
		durations := append([]float64(nil), values.DurationsMS...)
		sort.Float64s(durations)
		out.Endpoints[endpoint] = EndpointSnapshot{
			Requests: values.Requests,
			Errors:   values.Errors,
			P50MS:    percentile(durations, 0.50),
			P95MS:    percentile(durations, 0.95),
			P99MS:    percentile(durations, 0.99),
		}
	}
	return out
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(math.Ceil(float64(len(sorted))*p)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}
