package projects

import (
	"net/http/httptest"
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

func TestApplyCustomerProjectFilters(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/projects?customer_count=1&customer_domain=acme.com&customer_tier=enterprise&customer_status=active&important_customer_requests=1",
		nil,
	)
	where := "where p.workspace_id=$1"
	args := []any{"workspace-1"}

	if !projectCustomerFilterRequested(req) {
		t.Fatal("customer filters should be detected")
	}
	applyCustomerProjectFilters(req, &where, &args)

	if len(args) != 5 {
		t.Fatalf("args len = %d, args = %#v", len(args), args)
	}
	if args[1] != 1 || args[2] != "%acme.com%" ||
		args[3] != "enterprise" || args[4] != "active" {
		t.Fatalf("unexpected args: %#v", args)
	}
	for _, snippet := range []string{
		"count(distinct cr.customer_id)",
		"c.domain ilike $3",
		"c.tier=$4",
		"c.status=$5",
		"cr.important=true",
	} {
		if !strings.Contains(where, snippet) {
			t.Fatalf("where clause missing %q: %s", snippet, where)
		}
	}
}
