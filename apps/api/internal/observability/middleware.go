package observability

import (
	"net/http"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

type Metrics struct {
	Requests uint64 `json:"requests"`
	Errors   uint64 `json:"errors"`
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
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
			logger.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", recorder.status),
				zap.Duration("duration", duration),
			)
		})
	}
}

func Snapshot(metrics *Metrics) Metrics {
	return Metrics{
		Requests: atomic.LoadUint64(&metrics.Requests),
		Errors:   atomic.LoadUint64(&metrics.Errors),
	}
}
