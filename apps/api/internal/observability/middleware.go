package observability

import (
	"bufio"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type Metrics struct {
	Requests uint64 `json:"requests"`
	Errors   uint64 `json:"errors"`

	mu        sync.Mutex
	endpoints map[string]*endpointMetrics
	series    map[prometheusSeriesKey]*prometheusSeries
}

type endpointMetrics struct {
	Requests    uint64
	Errors      uint64
	DurationsMS []float64
}

type prometheusSeriesKey struct {
	Method string
	Route  string
	Status int
}

type prometheusSeries struct {
	Requests        uint64
	DurationBuckets []uint64
	DurationSum     float64
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

var prometheusDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

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
			route := routePattern(r)
			metrics.record(r.Method, route, recorder.status, duration)
			logger.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.String("route", route),
				zap.Int("status", recorder.status),
				zap.Duration("duration", duration),
			)
		})
	}
}

func routePattern(r *http.Request) string {
	if ctx := chi.RouteContext(r.Context()); ctx != nil {
		if pattern := ctx.RoutePattern(); pattern != "" {
			return pattern
		}
	}
	return "unmatched"
}

func (m *Metrics) record(method string, route string, status int, duration time.Duration) {
	m.mu.Lock()
	if m.endpoints == nil {
		m.endpoints = map[string]*endpointMetrics{}
	}
	endpoint := method + " " + route
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
	if m.series == nil {
		m.series = map[prometheusSeriesKey]*prometheusSeries{}
	}
	key := prometheusSeriesKey{Method: method, Route: route, Status: status}
	sample := m.series[key]
	if sample == nil {
		sample = &prometheusSeries{DurationBuckets: make([]uint64, len(prometheusDurationBuckets))}
		m.series[key] = sample
	}
	sample.Requests++
	durationSeconds := duration.Seconds()
	sample.DurationSum += durationSeconds
	for i, bucket := range prometheusDurationBuckets {
		if durationSeconds <= bucket {
			sample.DurationBuckets[i]++
		}
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

func Prometheus(metrics *Metrics) string {
	type sample struct {
		key             prometheusSeriesKey
		requests        uint64
		durationBuckets []uint64
		durationSum     float64
	}

	metrics.mu.Lock()
	samples := make([]sample, 0, len(metrics.series))
	for key, values := range metrics.series {
		samples = append(samples, sample{
			key:             key,
			requests:        values.Requests,
			durationBuckets: append([]uint64(nil), values.DurationBuckets...),
			durationSum:     values.DurationSum,
		})
	}
	metrics.mu.Unlock()

	sort.Slice(samples, func(i, j int) bool {
		if samples[i].key.Route != samples[j].key.Route {
			return samples[i].key.Route < samples[j].key.Route
		}
		if samples[i].key.Method != samples[j].key.Method {
			return samples[i].key.Method < samples[j].key.Method
		}
		return samples[i].key.Status < samples[j].key.Status
	})

	var b strings.Builder
	b.WriteString("# HELP exponential_http_requests_total Total HTTP requests handled by the Go API.\n")
	b.WriteString("# TYPE exponential_http_requests_total counter\n")
	for _, sample := range samples {
		fmt.Fprintf(&b, "exponential_http_requests_total{%s} %d\n", prometheusLabels(sample.key), sample.requests)
	}
	b.WriteString("# HELP exponential_http_request_duration_seconds HTTP request latency in seconds.\n")
	b.WriteString("# TYPE exponential_http_request_duration_seconds histogram\n")
	for _, sample := range samples {
		for i, bucket := range prometheusDurationBuckets {
			fmt.Fprintf(&b, "exponential_http_request_duration_seconds_bucket{%s,le=%q} %d\n", prometheusLabels(sample.key), strconv.FormatFloat(bucket, 'f', -1, 64), sample.durationBuckets[i])
		}
		fmt.Fprintf(&b, "exponential_http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\n", prometheusLabels(sample.key), sample.requests)
		fmt.Fprintf(&b, "exponential_http_request_duration_seconds_sum{%s} %s\n", prometheusLabels(sample.key), strconv.FormatFloat(sample.durationSum, 'f', -1, 64))
		fmt.Fprintf(&b, "exponential_http_request_duration_seconds_count{%s} %d\n", prometheusLabels(sample.key), sample.requests)
	}
	return b.String()
}

func prometheusLabels(key prometheusSeriesKey) string {
	return fmt.Sprintf("method=%q,route=%q,status=%q", key.Method, key.Route, strconv.Itoa(key.Status))
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
