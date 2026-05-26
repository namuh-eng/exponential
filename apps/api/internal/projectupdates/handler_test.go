package projectupdates

import (
	"testing"
	"time"
)

func TestValidateInputMatchesProjectUpdateErrors(t *testing.T) {
	v := validateInput(map[string]any{
		"name":            "Bad reminder",
		"cadence":         "weekly",
		"dueDay":          "friday",
		"dueTime":         "25:99",
		"timezone":        "UTC",
		"scope":           "active_projects",
		"reportingTarget": "workspace",
	}, false)
	if v.OK || v.Error != "Due time must use 24-hour HH:MM format" || v.Field != "dueTime" {
		t.Fatalf("validation = %#v", v)
	}
}

func TestBuildAndUpdateConfiguration(t *testing.T) {
	now := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	config := buildConfiguration(map[string]any{
		"name":            "Weekly reports",
		"enabled":         true,
		"cadence":         "weekly",
		"dueDay":          "monday",
		"dueTime":         "10:30",
		"timezone":        "America/Los_Angeles",
		"scope":           "active_projects",
		"projectIds":      []string{"project-1"},
		"reportingTarget": "slack",
		"shareTarget":     "#project-updates",
	}, now)
	if config.Name != "Weekly reports" || config.DueTime != "10:30" || config.ReportingTarget != "slack" || config.CreatedAt != now.Format(time.RFC3339Nano) {
		t.Fatalf("config = %#v", config)
	}
	updated := updateConfiguration(config, map[string]any{"enabled": false, "cadence": "biweekly"}, now.Add(time.Hour))
	if updated.Enabled || updated.Cadence != "biweekly" || updated.CreatedAt != config.CreatedAt || updated.UpdatedAt == config.UpdatedAt {
		t.Fatalf("updated = %#v", updated)
	}
}

func TestReadConfigurationsNormalizesAndSorts(t *testing.T) {
	settings := []byte(`{"projectUpdateConfigurations":[{"id":"b","createdAt":"2026-02-01T00:00:00Z","name":""},{"id":"a","createdAt":"2026-01-01T00:00:00Z","dueTime":"bad"}]}`)
	configs := readConfigurations(settings)
	if len(configs) != 2 || configs[0].ID != "a" || configs[0].DueTime != "09:00" || configs[1].Name != "Project update reminder" {
		t.Fatalf("configs = %#v", configs)
	}
}
