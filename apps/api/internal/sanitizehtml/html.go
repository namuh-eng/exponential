package sanitizehtml

import (
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

var richTextPolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.AllowAttrs("class").Matching(bluemonday.SpaceSeparatedTokens).OnElements("code", "pre")
	p.RequireNoFollowOnLinks(false)
	p.RequireNoReferrerOnLinks(false)
	p.AddTargetBlankToFullyQualifiedLinks(false)
	return p
}()

func RichText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.TrimSpace(richTextPolicy.Sanitize(value))
}
