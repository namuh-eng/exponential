package observability

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
)

func TestSnapshotReportsEndpointREDMetrics(t *testing.T) {
	metrics := &Metrics{}
	metrics.record("GET /v1/issues", 200, 10*time.Millisecond)
	metrics.record("GET /v1/issues", 503, 20*time.Millisecond)
	metrics.record("GET /v1/issues", 200, 30*time.Millisecond)

	snapshot := Snapshot(metrics)
	endpoint := snapshot.Endpoints["GET /v1/issues"]
	if endpoint.Requests != 3 || endpoint.Errors != 1 {
		t.Fatalf("endpoint = %#v", endpoint)
	}
	if endpoint.P50MS != 20 || endpoint.P95MS != 30 || endpoint.P99MS != 30 {
		t.Fatalf("percentiles = %#v", endpoint)
	}
}

func TestTraceMiddlewareAddsTraceIDHeader(t *testing.T) {
	shutdown, err := ConfigureTracing(context.Background(), TracingConfig{ServiceName: "test-api", Environment: "test"})
	if err != nil {
		t.Fatalf("ConfigureTracing: %v", err)
	}
	defer func() { _ = shutdown(context.Background()) }()

	handler := TraceMiddleware("test-api")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !trace.SpanContextFromContext(r.Context()).TraceID().IsValid() {
			t.Fatal("request context is missing an active trace span")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/issues", nil))

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get(TraceIDHeader); len(got) != 32 {
		t.Fatalf("trace id header = %q", got)
	}
}
