package integrations

import (
	"strings"
	"testing"
)

func TestNormalizeFigmaPluginSourceKeepsSafeSnapshotMetadata(t *testing.T) {
	name := " Checkout frame "
	thumbnail := "https://s3.example.test/figma/thumb.png"
	source, err := normalizeFigmaPluginSource(figmaPluginSourceInput{
		URL:          "https://figma.com/design/fileKey/Product?node-id=1-2&t=secret",
		Name:         &name,
		ThumbnailURL: &thumbnail,
		Selection:    map[string]any{"pageId": "0:1", "type": "FRAME"},
	})
	if err != nil {
		t.Fatalf("normalizeFigmaPluginSource returned error: %v", err)
	}
	if source.Link.NormalizedURL != "https://www.figma.com/design/fileKey?node-id=1%3A2" {
		t.Fatalf("normalized URL = %q", source.Link.NormalizedURL)
	}
	if source.Name == nil || *source.Name != "Checkout frame" {
		t.Fatalf("name = %#v", source.Name)
	}
	if source.ThumbnailURL == nil || *source.ThumbnailURL != thumbnail {
		t.Fatalf("thumbnail = %#v", source.ThumbnailURL)
	}
	if source.Snapshot["capturedBy"] != "figma_plugin" || source.Snapshot["originalUrl"] == "" {
		t.Fatalf("snapshot = %#v", source.Snapshot)
	}
}

func TestNormalizeFigmaPluginSourceRejectsUnsafeURLs(t *testing.T) {
	thumbnail := "javascript:alert(1)"
	_, err := normalizeFigmaPluginSource(figmaPluginSourceInput{
		URL:          "https://figma.com/board/fileKey/Unsupported",
		ThumbnailURL: &thumbnail,
	})
	if err == nil || !strings.Contains(err.Error(), "supported figma.com") {
		t.Fatalf("unsupported source error = %v", err)
	}

	_, err = normalizeFigmaPluginSource(figmaPluginSourceInput{
		URL:          "https://figma.com/file/fileKey/Supported",
		ThumbnailURL: &thumbnail,
	})
	if err == nil || !strings.Contains(err.Error(), "thumbnailUrl") {
		t.Fatalf("unsafe thumbnail error = %v", err)
	}
}

func TestFigmaPluginIssueDescriptionSanitizesProviderData(t *testing.T) {
	body := `<iframe src="https://evil.example"></iframe><p>Use design</p><script>alert(1)</script>`
	description := figmaPluginIssueDescription(&body, "https://www.figma.com/design/fileKey")
	if description == nil {
		t.Fatal("description is nil")
	}
	if strings.Contains(*description, "iframe") || strings.Contains(*description, "script") {
		t.Fatalf("description was not sanitized: %s", *description)
	}
	if !strings.Contains(*description, "Use design") {
		t.Fatalf("description lost safe content: %s", *description)
	}
}
