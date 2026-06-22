package figma

import "testing"

func TestParseLinkSupportedVariants(t *testing.T) {
	tests := []struct {
		name       string
		raw        string
		kind       string
		fileKey    string
		nodeID     string
		normalized string
	}{
		{
			name:       "file link",
			raw:        "https://www.figma.com/file/abc123/Product-Map?type=design&node-id=1-2&t=token",
			kind:       "file",
			fileKey:    "abc123",
			nodeID:     "1:2",
			normalized: "https://www.figma.com/file/abc123?node-id=1%3A2",
		},
		{
			name:       "design link",
			raw:        "https://figma.com/design/DesignKey/Specs?node-id=12%3A34)",
			kind:       "design",
			fileKey:    "DesignKey",
			nodeID:     "12:34",
			normalized: "https://www.figma.com/design/DesignKey?node-id=12%3A34",
		},
		{
			name:       "proto link without node",
			raw:        "http://figma.com/proto/protoKey/Flow",
			kind:       "proto",
			fileKey:    "protoKey",
			normalized: "https://www.figma.com/proto/protoKey",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			link, ok := ParseLink(tt.raw)
			if !ok {
				t.Fatalf("ParseLink(%q) rejected supported URL", tt.raw)
			}
			if link.Kind != tt.kind || link.FileKey != tt.fileKey || link.NodeID != tt.nodeID || link.NormalizedURL != tt.normalized {
				t.Fatalf("link = %#v", link)
			}
		})
	}
}

func TestParseLinkRejectsUnsupportedURLs(t *testing.T) {
	for _, raw := range []string{
		"https://example.com/file/abc",
		"https://www.figma.com/board/abc/Team",
		"javascript:alert(1)",
		"https://www.figma.com/file/",
		"not a url",
	} {
		if link, ok := ParseLink(raw); ok {
			t.Fatalf("ParseLink(%q) = %#v, true", raw, link)
		}
	}
}

func TestExtractLinksDedupesAndSorts(t *testing.T) {
	links := ExtractLinks(`
		<p>See https://figma.com/design/Beta/Two?node-id=3-4 and https://www.figma.com/file/Alpha/One.</p>
		<p>Duplicate https://www.figma.com/design/Beta/Another-name?node-id=3%3A4 plus https://example.com/nope.</p>
	`)
	if len(links) != 2 {
		t.Fatalf("expected 2 links, got %#v", links)
	}
	if links[0].NormalizedURL != "https://www.figma.com/design/Beta?node-id=3%3A4" {
		t.Fatalf("first normalized URL = %q", links[0].NormalizedURL)
	}
	if links[1].NormalizedURL != "https://www.figma.com/file/Alpha" {
		t.Fatalf("second normalized URL = %q", links[1].NormalizedURL)
	}
}
