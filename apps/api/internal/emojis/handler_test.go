package emojis

import "testing"

func TestNormalizeName(t *testing.T) {
	if got := normalizeName(":Ship_It:"); got != "ship_it" {
		t.Fatalf("name = %q", got)
	}
}

func TestValidateInput(t *testing.T) {
	name, url, msg := validateInput("ok", "https://example.com/ok.png")
	if msg != "" || name != "ok" || url == "" {
		t.Fatalf("unexpected validation: %q %q %q", name, url, msg)
	}
	_, _, msg = validateInput("Bad Space", "file:///no")
	if msg == "" {
		t.Fatal("expected invalid input")
	}
}
