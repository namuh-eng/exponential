package projects

import (
	"strings"
	"testing"
)

func TestSanitizeProjectSlug(t *testing.T) {
	if got := sanitizeProjectSlug(" My Great Project! "); got != "my-great-project" {
		t.Fatalf("slug = %q", got)
	}
}

func TestValidStatusAndPriority(t *testing.T) {
	if !validStatus("planned") || validStatus("done") {
		t.Fatal("status validation drifted")
	}
	if !validPriority("urgent") || validPriority("p0") {
		t.Fatal("priority validation drifted")
	}
}

func TestMicrosoftTeamsProjectUpdateText(t *testing.T) {
	project := Project{ID: "project-1", Name: "Teams Launch", Slug: "teams-launch"}
	got := microsoftTeamsProjectUpdateText(project, "Shipped tenant setup")
	if got != "Project update: Teams Launch\nShipped tenant setup" {
		t.Fatalf("text = %q", got)
	}
	long := strings.Repeat("a", 1900)
	got = microsoftTeamsProjectUpdateText(project, long)
	if !strings.HasSuffix(got, "…") || len(got) > 1840 {
		t.Fatalf("long text was not truncated: len=%d suffix=%q", len(got), got[len(got)-3:])
	}
}

func TestSalesforceProjectStatusPayload(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example/")
	project := Project{ID: "project-1", Name: "Customer Portal", Slug: "customer portal", Status: "started", Priority: "high"}
	payload := salesforceProjectStatusPayload(project, "500xx", "00001042")
	if payload["type"] != "sync_project_status" || payload["caseId"] != "500xx" {
		t.Fatalf("payload identity = %#v", payload)
	}
	if payload["status"] != "started" || payload["priority"] != "high" {
		t.Fatalf("payload status = %#v", payload)
	}
	if payload["projectUrl"] != "https://app.example/project/customer%20portal" {
		t.Fatalf("project url = %#v", payload["projectUrl"])
	}
}
