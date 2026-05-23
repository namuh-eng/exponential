package projects

import "testing"

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
