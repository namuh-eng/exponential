// Package email sends transactional mail (magic links, invitations, notifications)
// via either AWS SES or Opensend. A deployment that configures neither gets
// the Disabled sender, and any feature that depends on email is expected to
// short-circuit via Enabled() rather than fall back to a stand-in From address.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
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
//	EMAIL_PROVIDER=ses|opensend   explicit
//	OPENSEND_API_KEY set          → opensend
//	SENDER_EMAIL set              → ses
//	otherwise                     → Disabled
//
// SES needs SENDER_EMAIL (a verified From: address). Opensend additionally
// needs OPENSEND_API_KEY; OPENSEND_BASE_URL is only required when pointing
// at a self-hosted deployment.
func New(ctx context.Context) (Sender, error) {
	from := strings.TrimSpace(os.Getenv("SENDER_EMAIL"))
	apiKey := strings.TrimSpace(os.Getenv("OPENSEND_API_KEY"))
	choice := strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")))

	if choice == "" {
		switch {
		case apiKey != "":
			choice = "opensend"
		case from != "":
			choice = "ses"
		}
	}

	switch choice {
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
