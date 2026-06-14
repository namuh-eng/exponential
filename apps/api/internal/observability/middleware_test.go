package observability

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"nhooyr.io/websocket"
)

func TestSnapshotReportsEndpointREDMetrics(t *testing.T) {
	metrics := &Metrics{}
	metrics.record(http.MethodGet, "/v1/issues", 200, 10*time.Millisecond)
	metrics.record(http.MethodGet, "/v1/issues", 503, 20*time.Millisecond)
	metrics.record(http.MethodGet, "/v1/issues", 200, 30*time.Millisecond)

	snapshot := Snapshot(metrics)
	endpoint := snapshot.Endpoints["GET /v1/issues"]
	if endpoint.Requests != 3 || endpoint.Errors != 1 {
		t.Fatalf("endpoint = %#v", endpoint)
	}
	if endpoint.P50MS != 20 || endpoint.P95MS != 30 || endpoint.P99MS != 30 {
		t.Fatalf("percentiles = %#v", endpoint)
	}
}

func TestPrometheusReportsCountersAndHistograms(t *testing.T) {
	metrics := &Metrics{}
	metrics.record(http.MethodGet, "/v1/issues/{id}", 200, 12*time.Millisecond)
	metrics.record(http.MethodGet, "/v1/issues/{id}", 503, 275*time.Millisecond)

	output := Prometheus(metrics)
	for _, expected := range []string{
		"# TYPE exponential_http_requests_total counter",
		`exponential_http_requests_total{method="GET",route="/v1/issues/{id}",status="200"} 1`,
		`exponential_http_requests_total{method="GET",route="/v1/issues/{id}",status="503"} 1`,
		"# TYPE exponential_http_request_duration_seconds histogram",
		`exponential_http_request_duration_seconds_bucket{method="GET",route="/v1/issues/{id}",status="200",le="0.025"} 1`,
		`exponential_http_request_duration_seconds_bucket{method="GET",route="/v1/issues/{id}",status="503",le="0.25"} 0`,
		`exponential_http_request_duration_seconds_bucket{method="GET",route="/v1/issues/{id}",status="503",le="0.5"} 1`,
		`exponential_http_request_duration_seconds_count{method="GET",route="/v1/issues/{id}",status="503"} 1`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("Prometheus output missing %q:\n%s", expected, output)
		}
	}
}

func TestRequestLoggerAllowsWebSocketUpgrade(t *testing.T) {
	metrics := &Metrics{}
	handler := RequestLogger(zap.NewNop(), metrics)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("websocket accept: %v", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")
		if err := conn.Write(r.Context(), websocket.MessageText, []byte("ok")); err != nil {
			t.Errorf("websocket write: %v", err)
		}
	}))
	server := httptest.NewServer(handler)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	_, payload, err := conn.Read(context.Background())
	if err != nil {
		t.Fatalf("websocket read: %v", err)
	}
	if string(payload) != "ok" {
		t.Fatalf("payload = %q", payload)
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
