package integrations

import (
	"strings"
	"testing"
)

func TestGongSkipReason(t *testing.T) {
	call := gongCall{
		ID:              "call-1",
		DurationSeconds: 599,
		Privacy:         "public",
		Participants:    []gongParticipant{{Email: "ada@customer.example", External: true}},
	}
	if got := gongSkipReason(call); got != "recording_too_short" {
		t.Fatalf("short recording skip = %q", got)
	}

	call.DurationSeconds = 1200
	call.Privacy = "private"
	if got := gongSkipReason(call); got != "private_or_internal" {
		t.Fatalf("private call skip = %q", got)
	}

	call.Privacy = "public"
	call.Participants = []gongParticipant{{Email: "engineer@namuh.co", External: false, Role: "internal"}}
	if got := gongSkipReason(call); got != "no_external_participant" {
		t.Fatalf("internal call skip = %q", got)
	}
}

func TestGongExtractFindings(t *testing.T) {
	call := gongCall{
		ID:              "7788",
		Title:           "Acme renewal",
		URL:             "https://app.gong.io/call?id=7788",
		DurationSeconds: 1800,
		Privacy:         "public",
		Account:         gongAccount{Name: "Acme", Domain: "acme.example"},
		Participants: []gongParticipant{
			{Name: "Mina", Email: "mina@acme.example", Role: "customer", External: true},
			{Name: "Pat", Email: "pat@namuh.co", Role: "internal"},
		},
		Transcript: []gongTranscriptLine{
			{Speaker: "Pat", SpeakerEmail: "pat@namuh.co", StartMs: 20_000, Text: "We shipped the dashboard."},
			{Speaker: "Mina", SpeakerEmail: "mina@acme.example", SpeakerExternal: true, StartMs: 91_000, Text: "We need exports by requester so our support leads can triage these requests."},
			{Speaker: "Mina", SpeakerEmail: "mina@acme.example", SpeakerExternal: true, StartMs: 95_000, Text: "Thanks, that would help."},
		},
	}

	findings := gongExtractFindings(call)
	if len(findings) != 1 {
		t.Fatalf("findings len = %d", len(findings))
	}
	finding := findings[0]
	if !strings.HasPrefix(finding.ID, "7788:") {
		t.Fatalf("finding id = %q", finding.ID)
	}
	if !strings.Contains(finding.Title, "Acme: We need exports") {
		t.Fatalf("finding title = %q", finding.Title)
	}
	if finding.CustomerDomain != "acme.example" || finding.CustomerEmail != "mina@acme.example" {
		t.Fatalf("customer match = domain %q email %q", finding.CustomerDomain, finding.CustomerEmail)
	}
	if !strings.Contains(finding.Permalink, "t=91") {
		t.Fatalf("permalink = %q", finding.Permalink)
	}
	if !strings.Contains(finding.Description, "> We need exports by requester") {
		t.Fatalf("description = %q", finding.Description)
	}
}

func TestGongAuthorizationURL(t *testing.T) {
	t.Setenv("GONG_API_BASE_URL", "https://gong.example")
	got := gongAuthorizationURL("client-123", "https://app.example", "state-abc")
	for _, want := range []string{
		"https://gong.example/oauth2/authorize?",
		"client_id=client-123",
		"redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fgong%2Foauth%2Fcallback",
		"state=state-abc",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("authorization URL %q missing %q", got, want)
		}
	}
}
