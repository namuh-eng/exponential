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
