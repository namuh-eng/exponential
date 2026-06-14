package email

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
	"time"

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

func TestNewAutoSelectsSMTPWhenHostPresent(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_HOST", "localhost")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*smtpSender); !ok {
		t.Fatalf("expected *smtpSender, got %T", sender)
	}
}

func TestNewSMTPPrecedesOpensendInAutoSelect(t *testing.T) {
	// When SMTP_HOST is set alongside OPENSEND_API_KEY, SMTP should win
	// in auto-selection (SMTP is checked first).
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_HOST", "mail.example.com")
	t.Setenv("OPENSEND_API_KEY", "os_test")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*smtpSender); !ok {
		t.Fatalf("expected *smtpSender, got %T", sender)
	}
}

func TestNewSMTPExplicitProviderOverride(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_HOST", "mail.example.com")
	t.Setenv("OPENSEND_API_KEY", "os_test")
	t.Setenv("EMAIL_PROVIDER", "opensend")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := sender.(*opensendSender); !ok {
		t.Fatalf("expected *opensendSender when EMAIL_PROVIDER=opensend, got %T", sender)
	}
}

// TestNewSMTPExplicitMissingHostReturnsError verifies that EMAIL_PROVIDER=smtp
// with no SMTP_HOST returns an error rather than silently returning Disabled.
func TestNewSMTPExplicitMissingHostReturnsError(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("EMAIL_PROVIDER", "smtp")
	// SMTP_HOST intentionally omitted

	_, err := New(context.Background())
	if err == nil {
		t.Fatal("expected error when EMAIL_PROVIDER=smtp but SMTP_HOST is empty")
	}
	if !strings.Contains(err.Error(), "SMTP_HOST") {
		t.Errorf("error should mention SMTP_HOST, got: %v", err)
	}
}

// TestNewSMTPExplicitMissingFromReturnsError verifies that EMAIL_PROVIDER=smtp
// with no SENDER_EMAIL returns an error rather than silently returning Disabled.
func TestNewSMTPExplicitMissingFromReturnsError(t *testing.T) {
	resetEnv(t)
	t.Setenv("SMTP_HOST", "mail.example.com")
	t.Setenv("EMAIL_PROVIDER", "smtp")
	// SENDER_EMAIL intentionally omitted

	_, err := New(context.Background())
	if err == nil {
		t.Fatal("expected error when EMAIL_PROVIDER=smtp but SENDER_EMAIL is empty")
	}
	if !strings.Contains(err.Error(), "SENDER_EMAIL") {
		t.Errorf("error should mention SENDER_EMAIL, got: %v", err)
	}
}

func TestNewSMTPDisabledWhenFromMissing(t *testing.T) {
	// Auto-selection: SMTP_HOST triggers smtp choice, but SENDER_EMAIL is
	// missing — this is caught by the smtp case returning an error.
	resetEnv(t)
	t.Setenv("SMTP_HOST", "mail.example.com")
	// SENDER_EMAIL intentionally omitted

	_, err := New(context.Background())
	if err == nil {
		t.Fatalf("expected error when SMTP_HOST is set but SENDER_EMAIL is missing")
	}
}

func TestNewSMTPInvalidPort(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_HOST", "mail.example.com")
	t.Setenv("EMAIL_PROVIDER", "smtp")
	t.Setenv("SMTP_PORT", "not-a-number")

	_, err := New(context.Background())
	if err == nil {
		t.Fatal("expected error for invalid SMTP_PORT")
	}
	if !strings.Contains(err.Error(), "SMTP_PORT") {
		t.Errorf("error should mention SMTP_PORT, got: %v", err)
	}
}

func TestNewSMTPDefaultPort(t *testing.T) {
	resetEnv(t)
	t.Setenv("SENDER_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_HOST", "mail.example.com")
	t.Setenv("EMAIL_PROVIDER", "smtp")

	sender, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	s, ok := sender.(*smtpSender)
	if !ok {
		t.Fatalf("expected *smtpSender, got %T", sender)
	}
	if s.port != 587 {
		t.Errorf("default port = %d, want 587", s.port)
	}
}

func TestNewSMTPImplicitTLSFlag(t *testing.T) {
	for _, val := range []string{"true", "1", "yes"} {
		t.Run("SMTP_TLS="+val, func(t *testing.T) {
			resetEnv(t)
			t.Setenv("SENDER_EMAIL", "no-reply@example.com")
			t.Setenv("SMTP_HOST", "mail.example.com")
			t.Setenv("EMAIL_PROVIDER", "smtp")
			t.Setenv("SMTP_TLS", val)

			sender, err := New(context.Background())
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			s, ok := sender.(*smtpSender)
			if !ok {
				t.Fatalf("expected *smtpSender, got %T", sender)
			}
			if !s.implicitTLS {
				t.Errorf("SMTP_TLS=%q: expected implicitTLS=true", val)
			}
		})
	}
}

// TestSMTPSendAgainstMailhog spins up a real TCP listener that behaves like a
// minimal SMTP server (no AUTH, no STARTTLS — identical to Mailhog's dev
// profile) and verifies that smtpSender can deliver a full message through it.
func TestSMTPSendAgainstMailhog(t *testing.T) {
	// Minimal SMTP server: greets, accepts EHLO, accepts MAIL/RCPT/DATA, returns 250.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })

	type delivery struct {
		from    string
		to      string
		subject string
		body    string
	}
	// Buffered so the goroutine never blocks on send.
	delivered := make(chan delivery, 1)

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		var d delivery
		// Use a bufio.Scanner to read one SMTP command per line, avoiding the
		// TCP-coalescing hazard of a single large conn.Read that could return
		// multiple commands concatenated.
		scanner := bufio.NewScanner(conn)

		send := func(line string) {
			conn.Write([]byte(line + "\r\n"))
		}

		send("220 mailhog.local ESMTP")

		for scanner.Scan() {
			line := strings.TrimRight(scanner.Text(), "\r\n")
			upper := strings.ToUpper(line)

			switch {
			case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
				send("250-mailhog.local Hello")
				send("250 OK")
			case strings.HasPrefix(upper, "MAIL FROM:"):
				d.from = line
				send("250 OK")
			case strings.HasPrefix(upper, "RCPT TO:"):
				d.to = line
				send("250 OK")
			case upper == "DATA":
				send("354 End with <CRLF>.<CRLF>")
				// Read body lines until the bare "." terminator.
				var bodyLines []string
				for scanner.Scan() {
					bodyLine := scanner.Text()
					if bodyLine == "." {
						break
					}
					bodyLines = append(bodyLines, bodyLine)
				}
				d.body = strings.Join(bodyLines, "\n")
				// Extract subject from headers.
				for _, hdrLine := range bodyLines {
					if strings.HasPrefix(strings.ToLower(hdrLine), "subject:") {
						d.subject = strings.TrimSpace(hdrLine[8:])
					}
				}
				send("250 OK")
			case upper == "QUIT":
				// Record the delivery before acknowledging QUIT so that the
				// channel is populated before smtp.Client.Quit() returns to
				// the caller — eliminating the scheduler-preemption race
				// between Send() returning and the select below.
				delivered <- d
				send("221 Bye")
				return
			default:
				send("500 unrecognised")
			}
		}
	}()

	host, portStr, _ := net.SplitHostPort(ln.Addr().String())
	port, _ := net.LookupPort("tcp", portStr)

	sender := &smtpSender{
		from:        "no-reply@example.com",
		host:        host,
		port:        port,
		implicitTLS: false,
	}

	err = sender.Send(context.Background(), Message{
		To:      "user@example.com",
		Subject: "Magic link test",
		HTML:    "<p>Click here</p>",
		Text:    "Click here",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	select {
	case d := <-delivered:
		if !strings.Contains(d.from, "no-reply@example.com") {
			t.Errorf("MAIL FROM = %q, want no-reply@example.com", d.from)
		}
		if !strings.Contains(d.to, "user@example.com") {
			t.Errorf("RCPT TO = %q, want user@example.com", d.to)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for delivery")
	}
}

// TestSMTPBuildRawMessage verifies that the message builder includes expected
// headers and both body parts when Text is non-empty.
func TestSMTPBuildRawMessage(t *testing.T) {
	s := &smtpSender{from: "from@example.com"}
	raw, err := s.buildRawMessage(Message{
		To:      "to@example.com",
		Subject: "Hello",
		HTML:    "<p>Hi</p>",
		Text:    "Hi",
	})
	if err != nil {
		t.Fatalf("buildRawMessage: %v", err)
	}
	body := string(raw)

	for _, want := range []string{
		"From: from@example.com",
		"To: to@example.com",
		"MIME-Version: 1.0",
		"multipart/alternative",
		"text/plain",
		"text/html",
		"Content-Transfer-Encoding: quoted-printable",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("raw message missing %q", want)
		}
	}
	// Quoted-printable encodes "Hi" unchanged (pure ASCII, short line).
	if !strings.Contains(body, "Hi") {
		t.Errorf("raw message missing plain text content")
	}
	if !strings.Contains(body, "<p>Hi</p>") {
		t.Errorf("raw message missing HTML content")
	}
}

// TestSMTPBuildRawMessageHTMLOnly checks the single-part path when Text is empty.
func TestSMTPBuildRawMessageHTMLOnly(t *testing.T) {
	s := &smtpSender{from: "from@example.com"}
	raw, err := s.buildRawMessage(Message{
		To:      "to@example.com",
		Subject: "Hello",
		HTML:    "<p>Hi</p>",
	})
	if err != nil {
		t.Fatalf("buildRawMessage: %v", err)
	}
	body := string(raw)

	if strings.Contains(body, "multipart") {
		t.Errorf("single-part message should not contain multipart boundary, got:\n%s", body)
	}
	if !strings.Contains(body, "text/html") {
		t.Errorf("missing text/html content-type")
	}
	if !strings.Contains(body, "Content-Transfer-Encoding: quoted-printable") {
		t.Errorf("missing quoted-printable transfer encoding")
	}
}

// TestSMTPBuildRawMessageNonASCII verifies that non-ASCII content is properly
// quoted-printable encoded (the bug fixed: raw unencoded bytes are no longer
// written when Content-Transfer-Encoding: quoted-printable is declared).
func TestSMTPBuildRawMessageNonASCII(t *testing.T) {
	s := &smtpSender{from: "from@example.com"}
	raw, err := s.buildRawMessage(Message{
		To:      "to@example.com",
		Subject: "Test",
		HTML:    "<p>Héllo wörld</p>",
		Text:    "Héllo wörld",
	})
	if err != nil {
		t.Fatalf("buildRawMessage: %v", err)
	}
	body := string(raw)

	// Non-ASCII bytes must be QP-escaped (e.g. é → =C3=A9), not raw UTF-8.
	// The raw UTF-8 bytes for é are 0xC3 0xA9; they must not appear verbatim.
	if strings.Contains(body, "é") {
		t.Errorf("raw non-ASCII bytes found in quoted-printable body; encoder not applied")
	}
	// QP encoding of é (UTF-8 0xC3 0xA9) must be present.
	if !strings.Contains(body, "=C3=A9") {
		t.Errorf("expected QP-encoded =C3=A9 for é, not found in:\n%s", body)
	}
}

// Compile-time check: smtpSender must satisfy the Sender interface.
var _ smtp.Auth = nil // ensure net/smtp is used (keeps import live)
var _ Sender = (*smtpSender)(nil)

func resetEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"SENDER_EMAIL", "OPENSEND_API_KEY", "OPENSEND_BASE_URL", "EMAIL_PROVIDER",
		"SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_TLS",
	} {
		t.Setenv(key, "")
	}
}
