package sanitizehtml

import (
	"strings"
	"testing"
)

func TestRichTextStripsExecutableHTML(t *testing.T) {
	got := RichText(`<p onclick="alert(1)">safe<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a></p>`)
	for _, forbidden := range []string{"script", "onclick", "onerror", "javascript:"} {
		if strings.Contains(strings.ToLower(got), forbidden) {
			t.Fatalf("sanitized HTML still contains %q: %s", forbidden, got)
		}
	}
	if !strings.Contains(got, "safe") || !strings.Contains(got, "bad") {
		t.Fatalf("sanitized HTML lost expected text: %s", got)
	}
}
