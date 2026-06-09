package projectupdateconfigs

import "testing"

func TestValidateConfigurationRequiresValidCadenceAndSlackChannel(t *testing.T) {
	_, errMsg := validate(map[string]any{
		"name":         "Weekly report",
		"cadence":      "daily",
		"dayOfWeek":    float64(5),
		"timeOfDay":    "09:00",
		"projectScope": "active",
		"shareTargets": []any{"workspace"},
	}, "")
	if errMsg != "Choose a valid reminder cadence" {
		t.Fatalf("err = %q", errMsg)
	}

	_, errMsg = validate(map[string]any{
		"name":         "Weekly report",
		"cadence":      "weekly",
		"dayOfWeek":    float64(5),
		"timeOfDay":    "09:00",
		"projectScope": "active",
		"shareTargets": []any{"slack"},
	}, "")
	if errMsg != "Slack channel is required for Slack reports" {
		t.Fatalf("err = %q", errMsg)
	}
}

func TestValidateConfigurationNormalizesAllowedLists(t *testing.T) {
	config, errMsg := validate(map[string]any{
		"name":         " Weekly report ",
		"enabled":      false,
		"cadence":      "weekly",
		"dayOfWeek":    float64(5),
		"timeOfDay":    "09:00",
		"projectScope": "statuses",
		"statusScope":  []any{"started", "bogus", "started"},
		"shareTargets": []any{"workspace", "slack", "slack"},
		"slackChannel": " #project-updates ",
	}, "updates-1")
	if errMsg != "" {
		t.Fatalf("err = %q", errMsg)
	}
	if config.ID != "updates-1" || config.Name != "Weekly report" || config.Enabled {
		t.Fatalf("bad config = %#v", config)
	}
	if len(config.StatusScope) != 1 || config.StatusScope[0] != "started" || len(config.ShareTargets) != 2 {
		t.Fatalf("lists not normalized = %#v %#v", config.StatusScope, config.ShareTargets)
	}
	if config.SlackChannel == nil || *config.SlackChannel != "#project-updates" {
		t.Fatalf("slack channel = %#v", config.SlackChannel)
	}
}
