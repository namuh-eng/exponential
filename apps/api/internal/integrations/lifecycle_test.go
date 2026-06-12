package integrations

import (
	"testing"
	"time"
)

func TestBackoffDuration(t *testing.T) {
	cases := []struct {
		retryCount int
		wantMin    time.Duration
		wantMax    time.Duration
	}{
		{0, 30 * time.Second, 30 * time.Second},
		{1, 60 * time.Second, 60 * time.Second},
		{2, 2 * time.Minute, 2 * time.Minute},
		{3, 4 * time.Minute, 4 * time.Minute},
		{4, 8 * time.Minute, 8 * time.Minute},
		// cap at 2 hours
		{10, 2 * time.Hour, 2 * time.Hour},
		{20, 2 * time.Hour, 2 * time.Hour},
	}
	for _, tc := range cases {
		got := BackoffDuration(tc.retryCount)
		if got < tc.wantMin || got > tc.wantMax {
			t.Errorf("BackoffDuration(%d) = %v, want [%v, %v]", tc.retryCount, got, tc.wantMin, tc.wantMax)
		}
	}
}

func TestNextRunAt(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	got := NextRunAt(now, 0)
	if got != now.Add(30*time.Second) {
		t.Errorf("NextRunAt(now, 0) = %v, want %v", got, now.Add(30*time.Second))
	}
	got2 := NextRunAt(now, 1)
	if got2 != now.Add(60*time.Second) {
		t.Errorf("NextRunAt(now, 1) = %v, want %v", got2, now.Add(60*time.Second))
	}
}

func TestIsTerminal(t *testing.T) {
	if IsTerminal(0, 5) {
		t.Error("retry 0 of 5 should not be terminal")
	}
	if IsTerminal(4, 5) {
		t.Error("retry 4 of 5 should not be terminal")
	}
	if !IsTerminal(5, 5) {
		t.Error("retry 5 of 5 should be terminal")
	}
	if !IsTerminal(10, 5) {
		t.Error("retry 10 of 5 should be terminal")
	}
}

func TestTransitionJobStatus(t *testing.T) {
	if TransitionJobStatus(true, 0, 5) != JobStatusSucceeded {
		t.Error("succeeded attempt should return succeeded")
	}
	if TransitionJobStatus(false, 3, 5) != JobStatusFailed {
		t.Error("non-terminal failure should return failed")
	}
	if TransitionJobStatus(false, 5, 5) != JobStatusTerminal {
		t.Error("terminal failure should return terminal")
	}
	if TransitionJobStatus(false, 10, 5) != JobStatusTerminal {
		t.Error("over-limit failure should return terminal")
	}
}

func TestLifecycleStateConstants(t *testing.T) {
	// Ensure the constants map to expected values used in SQL / API.
	states := map[LifecycleState]string{
		LifecycleStateConfigurationRequired: "configuration_required",
		LifecycleStateInstalling:            "installing",
		LifecycleStateConnected:             "connected",
		LifecycleStateDegraded:              "degraded",
		LifecycleStateRevoked:               "revoked",
		LifecycleStateError:                 "error",
		LifecycleStateNotConnected:          "not_connected",
	}
	for state, expected := range states {
		if string(state) != expected {
			t.Errorf("LifecycleState constant %q does not equal expected %q", state, expected)
		}
	}
}

func TestJobTypeConstants(t *testing.T) {
	types := map[JobType]string{
		JobTypeWebhookIngest:    "webhook_ingest",
		JobTypeOutboundDelivery: "outbound_delivery",
		JobTypeBackfill:         "backfill",
		JobTypeSync:             "sync",
	}
	for jt, expected := range types {
		if string(jt) != expected {
			t.Errorf("JobType constant %q does not equal expected %q", jt, expected)
		}
	}
}
