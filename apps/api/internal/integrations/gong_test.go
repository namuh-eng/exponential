package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestGongCallFromAPIMapsAccountPartiesAndTranscript(t *testing.T) {
	var apiCall gongAPICall
	apiCall.MetaData.ID = "7788"
	apiCall.MetaData.URL = "https://app.gong.io/call?id=7788"
	apiCall.MetaData.Title = "Acme renewal"
	apiCall.MetaData.Duration = 1800
	apiCall.MetaData.Scope = "External"
	apiCall.MetaData.Started = "2026-06-16T12:00:00Z"
	apiCall.Context = []gongAPIContext{{Objects: []gongAPIContextObj{{ObjectType: "Account", ObjectID: "acct-1", Fields: []gongAPIFieldValue{{Name: "Name", Value: "Acme"}, {Name: "Website", Value: "https://www.acme.example/path"}}}}}}
	apiCall.Parties = []gongAPIParty{{SpeakerID: "spk-1", Name: "Mina", EmailAddress: "Mina@Acme.Example", Affiliation: "External"}, {SpeakerID: "spk-2", Name: "Pat", EmailAddress: "pat@namuh.co", Affiliation: "Internal"}}
	transcript := gongAPICallTranscript{CallID: "7788", Transcript: []gongAPIMonologue{{SpeakerID: "spk-1", Sentences: []gongAPISentence{{Start: 91_000, Text: "We need exports by requester."}}}}}

	call := gongCallFromAPI(apiCall, transcript)

	if call.Account.ID != "acct-1" || call.Account.Name != "Acme" || call.Account.Domain != "acme.example" {
		t.Fatalf("account = %#v", call.Account)
	}
	if len(call.Participants) != 2 || !call.Participants[0].External || call.Participants[0].Email != "mina@acme.example" {
		t.Fatalf("participants = %#v", call.Participants)
	}
	if len(call.Transcript) != 1 || !call.Transcript[0].SpeakerExternal || call.Transcript[0].Speaker != "Mina" {
		t.Fatalf("transcript = %#v", call.Transcript)
	}
}

func TestRetrieveGongCallsUsesExtensiveEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/calls/extensive" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-123" {
			t.Fatalf("authorization = %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["cursor"] != "page-1" {
			t.Fatalf("cursor = %#v", body["cursor"])
		}
		filter, ok := body["filter"].(map[string]any)
		if !ok || filter["fromDateTime"] != "2026-06-16T00:00:00Z" || filter["toDateTime"] != "2026-06-17T00:00:00Z" {
			t.Fatalf("filter = %#v", body["filter"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"records": map[string]any{"cursor": "page-2"}, "calls": []map[string]any{{"metaData": map[string]any{"id": "7788", "duration": 1200, "scope": "External"}}}})
	}))
	defer server.Close()
	t.Setenv("GONG_API_BASE_URL", server.URL)

	calls, cursor, err := retrieveGongCalls(context.Background(), server.Client(), gongCredential{AccessToken: "token-123"}, gongCallsRequest{FromDateTime: "2026-06-16T00:00:00Z", ToDateTime: "2026-06-17T00:00:00Z", Cursor: "page-1"})
	if err != nil {
		t.Fatal(err)
	}
	if cursor != "page-2" || len(calls) != 1 || calls[0].MetaData.ID != "7788" {
		t.Fatalf("calls=%#v cursor=%q", calls, cursor)
	}
}

func TestGongIntegrationDetailsExposeAdminConfiguration(t *testing.T) {
	details := gongIntegrationDetails(map[string]any{
		"destinationTeamId":   "team-1",
		"minimumDurationSec":  600,
		"statusWriteback":     "unsupported",
		"mentionParticipants": true,
		"tenantId":            "tenant-1",
	})
	if details["destinationTeamId"] != "team-1" || details["minimumDurationSec"] != "600" {
		t.Fatalf("details = %#v", details)
	}
	if details["statusWriteback"] != "unsupported" || details["mentionParticipants"] != true {
		t.Fatalf("writeback details = %#v", details)
	}
}

func TestGongPermissionFailureDetection(t *testing.T) {
	if !isGongPermissionFailure(gongAPIError{StatusCode: http.StatusForbidden, Message: "missing scope"}) {
		t.Fatal("403 provider error should degrade as a permission failure")
	}
	if isGongPermissionFailure(gongAPIError{StatusCode: http.StatusTooManyRequests, Message: "rate limit"}) {
		t.Fatal("rate-limit errors should not be classified as permission failures")
	}
}
