// Package email sends transactional mail (magic links, invitations, notifications)
// via AWS SES, Opensend, or a generic SMTP relay. A deployment that configures
// none of these gets the Disabled sender, and any feature that depends on email
// is expected to short-circuit via Enabled() rather than fall back to a
// stand-in From address.
package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

// Message is the wire-agnostic representation of one outgoing email.
// Text is optional; HTML is required.
type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string
}

// ErrDisabled is returned by Disabled.Send so callers that ignore Enabled()
// still see a typed error rather than a generic failure.
var ErrDisabled = errors.New("email provider is not configured")

// Sender abstracts the underlying provider so handlers don't care whether
// mail goes through SES, Opensend, or nowhere.
type Sender interface {
	Send(ctx context.Context, msg Message) error
	Enabled() bool
}

// Disabled is the sender used when no provider env is configured. Calling
// Send always returns ErrDisabled — callers should branch on Enabled().
type Disabled struct{}

func (Disabled) Send(context.Context, Message) error { return ErrDisabled }
func (Disabled) Enabled() bool                       { return false }

// New chooses a provider from the environment:
//
//	EMAIL_PROVIDER=ses|opensend|smtp   explicit
//	SMTP_HOST set                      → smtp
//	OPENSEND_API_KEY set               → opensend
//	SENDER_EMAIL set                   → ses
//	otherwise                          → Disabled
//
// SES needs SENDER_EMAIL (a verified From: address). Opensend additionally
// needs OPENSEND_API_KEY; OPENSEND_BASE_URL is only required when pointing
// at a self-hosted deployment. SMTP needs SMTP_HOST and SENDER_EMAIL;
// SMTP_PORT defaults to 587, SMTP_USERNAME/SMTP_PASSWORD are optional,
// SMTP_TLS controls implicit TLS on port 465 (STARTTLS is used otherwise).
func New(ctx context.Context) (Sender, error) {
	from := strings.TrimSpace(os.Getenv("SENDER_EMAIL"))
	apiKey := strings.TrimSpace(os.Getenv("OPENSEND_API_KEY"))
	smtpHost := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	choice := strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")))

	if choice == "" {
		switch {
		case smtpHost != "":
			choice = "smtp"
		case apiKey != "":
			choice = "opensend"
		case from != "":
			choice = "ses"
		}
	}

	switch choice {
	case "smtp":
		// An explicit EMAIL_PROVIDER=smtp with a missing SMTP_HOST or
		// SENDER_EMAIL is always a misconfiguration — return an error so the
		// caller (router.go) can log a clear warning rather than silently
		// degrading to Disabled.
		if smtpHost == "" {
			return nil, fmt.Errorf("EMAIL_PROVIDER=smtp requires SMTP_HOST to be set")
		}
		if from == "" {
			return nil, fmt.Errorf("EMAIL_PROVIDER=smtp requires SENDER_EMAIL to be set")
		}
		portStr := strings.TrimSpace(os.Getenv("SMTP_PORT"))
		port := 587
		if portStr != "" {
			p, err := strconv.Atoi(portStr)
			if err != nil {
				return nil, fmt.Errorf("invalid SMTP_PORT %q: %w", portStr, err)
			}
			port = p
		}
		tlsStr := strings.ToLower(strings.TrimSpace(os.Getenv("SMTP_TLS")))
		implicitTLS := tlsStr == "true" || tlsStr == "1" || tlsStr == "yes"
		return &smtpSender{
			from:        from,
			host:        smtpHost,
			port:        port,
			username:    strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
			password:    strings.TrimSpace(os.Getenv("SMTP_PASSWORD")),
			implicitTLS: implicitTLS,
		}, nil
	case "opensend":
		if from == "" || apiKey == "" {
			return Disabled{}, nil
		}
		baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENSEND_BASE_URL")), "/")
		if baseURL == "" {
			baseURL = "https://opensend.namuh.co"
		}
		return &opensendSender{
			from:    from,
			apiKey:  apiKey,
			baseURL: baseURL,
			client:  &http.Client{Timeout: 10 * time.Second},
		}, nil
	case "ses":
		if from == "" {
			return Disabled{}, nil
		}
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			return nil, fmt.Errorf("load aws config: %w", err)
		}
		return &sesSender{from: from, api: sesv2.NewFromConfig(cfg)}, nil
	default:
		return Disabled{}, nil
	}
}

type sesSendAPI interface {
	SendEmail(ctx context.Context, in *sesv2.SendEmailInput, opts ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error)
}

type sesSender struct {
	from string
	api  sesSendAPI
}

func (s *sesSender) Enabled() bool { return true }

func (s *sesSender) Send(ctx context.Context, msg Message) error {
	body := &types.Body{Html: &types.Content{Data: aws.String(msg.HTML)}}
	if msg.Text != "" {
		body.Text = &types.Content{Data: aws.String(msg.Text)}
	}
	_, err := s.api.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(s.from),
		Destination:      &types.Destination{ToAddresses: []string{msg.To}},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{Data: aws.String(msg.Subject)},
				Body:    body,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("ses send: %w", err)
	}
	return nil
}

// smtpSender sends mail via a plain SMTP relay.
// It supports two transport modes:
//   - implicitTLS=true: dial with TLS from the start (port 465 convention).
//   - implicitTLS=false: plain dial then STARTTLS upgrade when the server
//     advertises it (port 587 / 25 convention). If the server does not
//     advertise STARTTLS the connection stays unencrypted — appropriate only
//     for loopback relays such as Mailhog.
//
// SMTP_USERNAME / SMTP_PASSWORD are optional; when both are non-empty the
// sender tries AUTH PLAIN first and falls back to AUTH LOGIN if the server
// does not advertise PLAIN support.
type smtpSender struct {
	from        string
	host        string
	port        int
	username    string
	password    string
	implicitTLS bool
}

func (s *smtpSender) Enabled() bool { return true }

func (s *smtpSender) Send(_ context.Context, msg Message) error {
	addr := net.JoinHostPort(s.host, strconv.Itoa(s.port))

	// Build the raw RFC 2822 message body.
	raw, err := s.buildRawMessage(msg)
	if err != nil {
		return fmt.Errorf("smtp build message: %w", err)
	}

	if s.implicitTLS {
		return s.sendImplicitTLS(addr, msg.To, raw)
	}
	return s.sendSTARTTLS(addr, msg.To, raw)
}

// writeQP encodes src into dst using quoted-printable encoding, returning any
// error from the encoder.
func writeQP(dst *bytes.Buffer, src string) error {
	w := quotedprintable.NewWriter(dst)
	if _, err := io.WriteString(w, src); err != nil {
		return err
	}
	return w.Close()
}

// buildRawMessage returns a minimal RFC 2822 message suitable for smtp.SendMail.
// Body parts are encoded with quoted-printable as declared in
// Content-Transfer-Encoding.
func (s *smtpSender) buildRawMessage(msg Message) ([]byte, error) {
	var b bytes.Buffer
	writeHeader := func(key, value string) {
		b.WriteString(key)
		b.WriteString(": ")
		b.WriteString(value)
		b.WriteString("\r\n")
	}

	enc := mime.QEncoding
	writeHeader("From", s.from)
	writeHeader("To", msg.To)
	writeHeader("Subject", enc.Encode("utf-8", msg.Subject))
	writeHeader("MIME-Version", "1.0")

	if msg.Text != "" {
		boundary := "==exponential_boundary=="
		writeHeader("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
		b.WriteString("\r\n")
		// plain text part — quoted-printable encoded
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		if err := writeQP(&b, msg.Text); err != nil {
			return nil, fmt.Errorf("encode text/plain: %w", err)
		}
		b.WriteString("\r\n")
		// HTML part — quoted-printable encoded
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		if err := writeQP(&b, msg.HTML); err != nil {
			return nil, fmt.Errorf("encode text/html: %w", err)
		}
		b.WriteString("\r\n")
		b.WriteString("--" + boundary + "--\r\n")
	} else {
		writeHeader("Content-Type", "text/html; charset=utf-8")
		writeHeader("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := writeQP(&b, msg.HTML); err != nil {
			return nil, fmt.Errorf("encode text/html: %w", err)
		}
	}

	return b.Bytes(), nil
}

// smtpAuth returns an smtp.Auth appropriate for the server's advertised
// mechanisms. It tries PLAIN first; if the server does not advertise PLAIN it
// falls back to LOGIN. Returns nil when no credentials are configured.
func smtpAuth(c *smtp.Client, host, username, password string) (smtp.Auth, error) {
	if username == "" || password == "" {
		return nil, nil
	}
	// Inspect the server's AUTH advertisement.
	ok, params := c.Extension("AUTH")
	if !ok {
		// Server did not advertise AUTH at all; attempt PLAIN anyway and let
		// the server reject it with a clear error.
		return smtp.PlainAuth("", username, password, host), nil
	}
	mechanisms := strings.ToUpper(params)
	if strings.Contains(mechanisms, "PLAIN") {
		return smtp.PlainAuth("", username, password, host), nil
	}
	if strings.Contains(mechanisms, "LOGIN") {
		return &loginAuth{username: username, password: password}, nil
	}
	// Fall back to PLAIN; the server will give an actionable error if it
	// doesn't support it.
	return smtp.PlainAuth("", username, password, host), nil
}

// loginAuth implements the AUTH LOGIN mechanism used by many shared-hosting
// SMTP relays (e.g. cPanel, some Gmail configurations).
type loginAuth struct {
	username string
	password string
}

func (a *loginAuth) Start(_ *smtp.ServerInfo) (string, []byte, error) {
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	prompt := strings.ToLower(strings.TrimRight(string(fromServer), ": \r\n"))
	switch prompt {
	case "username":
		return []byte(a.username), nil
	case "password":
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("smtp LOGIN: unexpected server prompt %q", string(fromServer))
	}
}

// sendSTARTTLS connects in plain mode, upgrades with STARTTLS when advertised,
// and sends the message. This covers port 587 and loopback relays (Mailhog).
func (s *smtpSender) sendSTARTTLS(addr string, to string, raw []byte) error {
	c, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	defer c.Close()

	// Upgrade to TLS only when the server supports it; loopback relays like
	// Mailhog do not advertise STARTTLS and that is expected.
	if ok, _ := c.Extension("STARTTLS"); ok {
		tlsCfg := &tls.Config{ServerName: s.host}
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	if s.username != "" && s.password != "" {
		auth, err := smtpAuth(c, s.host, s.username, s.password)
		if err != nil {
			return fmt.Errorf("smtp auth select: %w", err)
		}
		if auth != nil {
			if err := c.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
	}

	if err := c.Mail(s.from); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	wc, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := wc.Write(raw); err != nil {
		_ = wc.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("smtp data close: %w", err)
	}
	return c.Quit()
}

// sendImplicitTLS dials with TLS from the start (port 465 convention) then
// sends the message.
func (s *smtpSender) sendImplicitTLS(addr string, to string, raw []byte) error {
	tlsCfg := &tls.Config{ServerName: s.host}
	conn, err := tls.Dial("tcp", addr, tlsCfg)
	if err != nil {
		return fmt.Errorf("smtp tls dial: %w", err)
	}

	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp new client: %w", err)
	}
	defer c.Close()

	if s.username != "" && s.password != "" {
		auth, err := smtpAuth(c, s.host, s.username, s.password)
		if err != nil {
			return fmt.Errorf("smtp auth select: %w", err)
		}
		if auth != nil {
			if err := c.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
	}

	if err := c.Mail(s.from); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	wc, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := wc.Write(raw); err != nil {
		_ = wc.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("smtp data close: %w", err)
	}
	return c.Quit()
}

type opensendSender struct {
	from    string
	apiKey  string
	baseURL string
	client  *http.Client
}

func (o *opensendSender) Enabled() bool { return true }

func (o *opensendSender) Send(ctx context.Context, msg Message) error {
	payload := map[string]string{
		"from":    o.from,
		"to":      msg.To,
		"subject": msg.Subject,
		"html":    msg.HTML,
	}
	if msg.Text != "" {
		payload["text"] = msg.Text
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("opensend marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/emails", bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("opensend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("opensend send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var apiErr struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &apiErr)
	if apiErr.Message != "" {
		return fmt.Errorf("opensend send (%d): %s", resp.StatusCode, apiErr.Message)
	}
	return fmt.Errorf("opensend send: HTTP %d", resp.StatusCode)
}
