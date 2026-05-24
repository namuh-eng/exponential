package observability

import (
	"testing"
	"time"
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
