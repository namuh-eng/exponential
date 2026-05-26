package labels

import "testing"

func TestNormalizeColor(t *testing.T) {
	if got := normalizeColor("#ABCDEF", "#000000"); got != "#abcdef" {
		t.Fatalf("color = %q", got)
	}
	if got := normalizeColor("blue", "#6b6f76"); got != "#6b6f76" {
		t.Fatalf("fallback = %q", got)
	}
}

func TestNullableTrim(t *testing.T) {
	blank := "  "
	if nullableTrim(&blank) != nil {
		t.Fatal("blank should normalize to nil")
	}
	value := " ok "
	got := nullableTrim(&value)
	if got == nil || *got != "ok" {
		t.Fatalf("trim = %#v", got)
	}
}

func TestUniqueStrings(t *testing.T) {
	got := uniqueStrings([]string{" a ", "a", "", "b"})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("unique strings = %#v", got)
	}
}
