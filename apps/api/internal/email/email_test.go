package email

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/sesv2"
)

func TestNewReturnsDisabledWhenUnconfigured(t *testing.T) {
	resetEnv(t)
	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if sender.Enabled() {
		t.Fatalf("expected Disabled, got %T", sender)
	}
	if got := sender.Send(context.Background(), Message{}); !errors.Is(got, ErrDisabled) {
		t.Fatalf("expected ErrDisabled, got %v", got)
	}
}

func TestNewAutoSelectsOpensendWhenAPIKeyPresent(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("OPENSEND_API_KEY", "os_test")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*opensendSender); !ok {
		t.Fatalf("expected *opensendSender, got %T", sender)
	}
}

func TestNewExplicitProviderOverridesAuto(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("OPENSEND_API_KEY", "os_test")
	t.Setenv("EMAIL_PROVIDER", "ses")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*sesSender); !ok {
		t.Fatalf("expected *sesSender, got %T", sender)
	}
}

func TestOpensendSendPostsExpectedRequest(t *testing.T) {
	var captured struct {
		method string
		path   string
		auth   string
		ctype  string
		body   map[string]string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.method = r.Method
		captured.path = r.URL.Path
		captured.auth = r.Header.Get("Authorization")
		captured.ctype = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &captured.body)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"em_1"}`))
	}))
	t.Cleanup(server.Close)

	sender := &opensendSender{
		from:    "no-reply@example.com",
		apiKey:  "os_test",
		baseURL: server.URL,
		client:  server.Client(),
	}

	err := sender.Send(context.Background(), Message{
		To:      "user@example.com",
		Subject: "Hi",
		HTML:    "<p>Hi</p>",
		Text:    "Hi",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if captured.method != http.MethodPost {
		t.Errorf("method = %q, want POST", captured.method)
	}
	if captured.path != "/emails" {
		t.Errorf("path = %q, want /emails", captured.path)
	}
	if captured.auth != "Bearer os_test" {
		t.Errorf("Authorization = %q, want %q", captured.auth, "Bearer os_test")
	}
	if !strings.HasPrefix(captured.ctype, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", captured.ctype)
	}
	wantBody := map[string]string{
		"from":    "no-reply@example.com",
		"to":      "user@example.com",
		"subject": "Hi",
		"html":    "<p>Hi</p>",
		"text":    "Hi",
	}
	for k, v := range wantBody {
		if captured.body[k] != v {
			t.Errorf("body[%q] = %q, want %q", k, captured.body[k], v)
		}
	}
}

func TestOpensendSendOmitsEmptyText(t *testing.T) {
	var received map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &received)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	sender := &opensendSender{from: "f@x", apiKey: "k", baseURL: server.URL, client: server.Client()}
	if err := sender.Send(context.Background(), Message{To: "u@x", Subject: "S", HTML: "<p>H</p>"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if _, ok := received["text"]; ok {
		t.Errorf("expected text field to be omitted when empty, got %v", received["text"])
	}
}

func TestOpensendSendSurfacesAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"message":"rate limited"}`))
	}))
	t.Cleanup(server.Close)

	sender := &opensendSender{from: "f@x", apiKey: "k", baseURL: server.URL, client: server.Client()}
	err := sender.Send(context.Background(), Message{To: "u@x", Subject: "S", HTML: "<p>H</p>"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "rate limited") || !strings.Contains(err.Error(), "429") {
		t.Errorf("error = %q, want it to mention status and message", err.Error())
	}
}

type stubSES struct {
	in  *sesv2.SendEmailInput
	err error
}

func (s *stubSES) SendEmail(_ context.Context, in *sesv2.SendEmailInput, _ ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error) {
	s.in = in
	return &sesv2.SendEmailOutput{}, s.err
}

func TestSESSendBuildsExpectedInput(t *testing.T) {
	stub := &stubSES{}
	sender := &sesSender{from: "no-reply@example.com", api: stub}

	err := sender.Send(context.Background(), Message{
		To:      "user@example.com",
		Subject: "Hello",
		HTML:    "<p>Hi</p>",
		Text:    "Hi",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if stub.in == nil || stub.in.FromEmailAddress == nil || *stub.in.FromEmailAddress != "no-reply@example.com" {
		t.Fatalf("FromEmailAddress not propagated: %+v", stub.in)
	}
	if got := stub.in.Destination.ToAddresses; len(got) != 1 || got[0] != "user@example.com" {
		t.Errorf("ToAddresses = %v, want [user@example.com]", got)
	}
	simple := stub.in.Content.Simple
	if simple.Subject == nil || *simple.Subject.Data != "Hello" {
		t.Errorf("Subject not propagated")
	}
	if simple.Body.Html == nil || *simple.Body.Html.Data != "<p>Hi</p>" {
		t.Errorf("HTML body not propagated")
	}
	if simple.Body.Text == nil || *simple.Body.Text.Data != "Hi" {
		t.Errorf("Text body not propagated")
	}
}

func TestSESSendOmitsTextWhenEmpty(t *testing.T) {
	stub := &stubSES{}
	sender := &sesSender{from: "f@x", api: stub}
	if err := sender.Send(context.Background(), Message{To: "u@x", Subject: "S", HTML: "<p>H</p>"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if stub.in.Content.Simple.Body.Text != nil {
		t.Errorf("expected Text body to be nil when Message.Text is empty")
	}
}

func TestSESSendWrapsError(t *testing.T) {
	stub := &stubSES{err: errors.New("throttle")}
	sender := &sesSender{from: "f@x", api: stub}
	err := sender.Send(context.Background(), Message{To: "u@x", Subject: "S", HTML: "<p>H</p>"})
	if err == nil || !strings.Contains(err.Error(), "throttle") {
		t.Fatalf("expected wrapped throttle error, got %v", err)
	}
}

func resetEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"SENDER_EMAIL", "OPENSEND_API_KEY", "OPENSEND_BASE_URL", "EMAIL_PROVIDER"} {
		t.Setenv(key, "")
	}
}
