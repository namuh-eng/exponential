package teams

import "testing"

func TestTeamKeyBase(t *testing.T) {
	if got := teamKeyBase("Linear Clone"); got != "LIN" {
		t.Fatalf("key = %q", got)
	}
	if got := teamKeyBase("123"); got != "WRK" {
		t.Fatalf("numeric key base = %q", got)
	}
}

func TestValidateKey(t *testing.T) {
	if err := validateKey("ENG"); err != nil {
		t.Fatalf("expected valid key: %v", err)
	}
	if err := validateKey("1BAD"); err == nil {
		t.Fatal("expected first-char validation failure")
	}
	if err := validateKey("TOO-LONG"); err == nil {
		t.Fatal("expected character validation failure")
	}
}

func TestParseCycleDate(t *testing.T) {
	if _, ok := parseCycleDate("2026-05-24"); !ok {
		t.Fatal("expected date-only cycle date")
	}
	if _, ok := parseCycleDate("not-a-date"); ok {
		t.Fatal("expected invalid cycle date")
	}
}

func TestEstimateOptions(t *testing.T) {
	if got := estimateOptions("not_in_use"); len(got) != 0 {
		t.Fatalf("estimates = %#v", got)
	}
	got := estimateOptions("fibonacci")
	if len(got) != 5 || got[0].Label != "1 point" || got[1].Label != "2 points" {
		t.Fatalf("estimates = %#v", got)
	}
}

func TestCreateIssueOptionStaticLists(t *testing.T) {
	if len(priorityOptions()) != 5 {
		t.Fatal("priority options drifted")
	}
	if len(dueDatePresets()) != 4 {
		t.Fatal("due date presets drifted")
	}
}
