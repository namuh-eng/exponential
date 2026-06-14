package projects

import (
	"strings"
	"testing"
)

func TestSlackProjectUpdateChannelSupportsCurrentAndLegacyConfigs(t *testing.T) {
	current := map[string]any{
		"enabled":      true,
		"shareTargets": []any{"workspace", "slack"},
		"slackChannel": " #project-updates ",
	}
	if got := slackProjectUpdateChannel(current); got != "#project-updates" {
		t.Fatalf("current channel = %q", got)
	}

	legacy := map[string]any{
		"reportingTarget": "slack",
		"shareTarget":     "C123",
	}
	if got := slackProjectUpdateChannel(legacy); got != "C123" {
		t.Fatalf("legacy channel = %q", got)
	}

	disabled := map[string]any{
		"enabled":      false,
		"shareTargets": []any{"slack"},
		"slackChannel": "#project-updates",
	}
	if got := slackProjectUpdateChannel(disabled); got != "" {
		t.Fatalf("disabled channel = %q", got)
	}
}

func TestSlackProjectUpdateConfigMatchesScopes(t *testing.T) {
	started := Project{ID: "project-1", Status: "started"}
	completed := Project{ID: "project-2", Status: "completed"}

	if !slackProjectUpdateConfigMatches(map[string]any{"projectScope": "active"}, started) {
		t.Fatal("started project should match active project update config")
	}
	if slackProjectUpdateConfigMatches(map[string]any{"projectScope": "active"}, completed) {
		t.Fatal("completed project should not match active project update config")
	}
	if !slackProjectUpdateConfigMatches(map[string]any{"projectScope": "statuses", "statusScope": []any{"started"}}, started) {
		t.Fatal("status-scoped config should match project status")
	}
	if !slackProjectUpdateConfigMatches(map[string]any{"scope": "selected_projects", "projectIds": []any{"project-1"}}, started) {
		t.Fatal("legacy selected project config should match project id")
	}
}

func TestSlackProjectUpdateTextLinksProjectAndTruncatesBody(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example")
	body := strings.Repeat("a", 2700)
	got := slackProjectUpdateText(Project{Name: "Launch", Slug: "launch"}, body)
	if !strings.HasPrefix(got, "Project update for <https://app.example/project/launch|Launch>:\n") {
		t.Fatalf("text = %q", got)
	}
	if len([]rune(got)) >= len("Project update for <https://app.example/project/launch|Launch>:\n")+2700 {
		t.Fatalf("body was not truncated: %d", len([]rune(got)))
	}
	if !strings.HasSuffix(got, "...") {
		t.Fatalf("truncated text missing suffix: %q", got[len(got)-10:])
	}
}
