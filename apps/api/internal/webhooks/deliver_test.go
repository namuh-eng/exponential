package webhooks

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Signature tests
// ---------------------------------------------------------------------------

func TestComputeSignature(t *testing.T) {
	t.Parallel()
	secret := "whsec_test"
	payload := []byte(`{"type":"issue.created"}`)
	sig := ComputeSignature(secret, payload)
	if sig == "" {
		t.Fatal("expected non-empty signature")
	}
	if sig[:7] != "sha256=" {
		t.Fatalf("expected signature to start with sha256=, got %s", sig)
	}
}

func TestVerifySignature(t *testing.T) {
	t.Parallel()
	secret := "whsec_test"
	payload := []byte(`{"type":"issue.created"}`)
	sig := ComputeSignature(secret, payload)

	if !VerifySignature(secret, payload, sig) {
		t.Fatal("expected VerifySignature to return true for valid signature")
	}
	if VerifySignature(secret, payload, "sha256=badhash") {
		t.Fatal("expected VerifySignature to return false for invalid signature")
	}
	if VerifySignature("wrongsecret", payload, sig) {
		t.Fatal("expected VerifySignature to return false for wrong secret")
	}
}

func TestVerifySignature_DifferentPayload(t *testing.T) {
	t.Parallel()
	secret := "whsec_test"
	payload := []byte(`{"type":"issue.created"}`)
	sig := ComputeSignature(secret, payload)

	tampered := []byte(`{"type":"issue.deleted"}`)
	if VerifySignature(secret, tampered, sig) {
		t.Fatal("expected VerifySignature to return false for tampered payload")
	}
}

// ---------------------------------------------------------------------------
// Backoff tests
// ---------------------------------------------------------------------------

func TestBackoffDuration(t *testing.T) {
	t.Parallel()
	cases := []struct {
		attempt  int
		expected time.Duration
	}{
		{1, 30 * time.Second},
		{2, 5 * time.Minute},
		{3, 30 * time.Minute},
		{4, 2 * time.Hour},
		{5, 6 * time.Hour},
		{99, 6 * time.Hour},
	}
	for _, tc := range cases {
		got := backoffDuration(tc.attempt)
		if got != tc.expected {
			t.Errorf("backoffDuration(%d) = %v; want %v", tc.attempt, got, tc.expected)
		}
	}
}

// ---------------------------------------------------------------------------
// HTTP delivery tests (using httptest server)
// ---------------------------------------------------------------------------

func TestSendWebhookRequest_Success(t *testing.T) {
	t.Parallel()
	secret := "whsec_abc"
	payload := []byte(`{"type":"issue.created","data":{"id":"123"}}`)

	var receivedSig, receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedSig = r.Header.Get("X-Exponential-Signature")
		b, _ := io.ReadAll(r.Body)
		receivedBody = string(b)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	statusCode, _, err := sendWebhookRequest(context.Background(), srv.URL, payload, &secret, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if statusCode != 200 {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if receivedBody != string(payload) {
		t.Fatalf("body mismatch: got %s", receivedBody)
	}
	if !VerifySignature(secret, payload, receivedSig) {
		t.Fatalf("signature on received request did not verify: %s", receivedSig)
	}
}

func TestSendWebhookRequest_NoSecret(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"type":"issue.updated"}`)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Exponential-Signature") != "" {
			t.Error("expected no signature header when secret is nil")
		}
		w.WriteHeader(204)
	}))
	defer srv.Close()

	statusCode, _, err := sendWebhookRequest(context.Background(), srv.URL, payload, nil, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if statusCode != 204 {
		t.Fatalf("expected 204, got %d", statusCode)
	}
}

func TestSendWebhookRequest_ServerError(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"type":"issue.created"}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		fmt.Fprint(w, "service unavailable")
	}))
	defer srv.Close()

	statusCode, body, err := sendWebhookRequest(context.Background(), srv.URL, payload, nil, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if statusCode != 503 {
		t.Fatalf("expected 503, got %d", statusCode)
	}
	if body != "service unavailable" {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestSendWebhookRequest_NetworkError(t *testing.T) {
	t.Parallel()
	payload := []byte(`{}`)
	// Use an invalid target that will fail immediately (port 1 is never open).
	_, _, err := sendWebhookRequest(context.Background(), "http://127.0.0.1:1", payload, nil, true)
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
}

// TestValidateWebhookURL_BlocksPrivate verifies that the SSRF guard rejects
// private/loopback addresses when skipSSRFValidation is false (production mode).
func TestValidateWebhookURL_BlocksPrivate(t *testing.T) {
	t.Parallel()
	cases := []string{
		"http://localhost/hook",
		"http://127.0.0.1/hook",
		"http://192.168.1.1/hook",
		"http://10.0.0.1/hook",
		"http://172.16.0.1/hook",
		"http://169.254.169.254/latest/meta-data/",
	}
	for _, u := range cases {
		err := validateWebhookURL(u)
		if err == nil {
			t.Errorf("validateWebhookURL(%q) should have returned an error but did not", u)
		}
	}
}

// ---------------------------------------------------------------------------
// ValidEventType tests
// ---------------------------------------------------------------------------

func TestValidEventType(t *testing.T) {
	t.Parallel()
	for _, et := range KnownEventTypes {
		if !ValidEventType(et) {
			t.Errorf("ValidEventType(%q) should be true", et)
		}
	}
	if ValidEventType("unknown.event") {
		t.Error("ValidEventType(unknown.event) should be false")
	}
	if ValidEventType("") {
		t.Error("ValidEventType('') should be false")
	}
}

// ---------------------------------------------------------------------------
// jsonArray helper test
// ---------------------------------------------------------------------------

func TestJSONArray(t *testing.T) {
	t.Parallel()
	got := jsonArray("issue.created")
	var parsed []string
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("failed to parse jsonArray output: %v", err)
	}
	if len(parsed) != 1 || parsed[0] != "issue.created" {
		t.Fatalf("unexpected jsonArray output: %s", got)
	}
}

// ---------------------------------------------------------------------------
// Truncate helper tests
// ---------------------------------------------------------------------------

func TestTruncate(t *testing.T) {
	t.Parallel()
	if got := truncate("hello", 10); got != "hello" {
		t.Errorf("got %s", got)
	}
	if got := truncate("hello world", 5); got != "hello" {
		t.Errorf("got %s", got)
	}
}
