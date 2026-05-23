package documents

import (
	"encoding/json"
	"testing"
)

func TestReadSettingsNormalizesDocuments(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"documents": map[string]any{"templates": []map[string]any{{"id": "t1", "name": " Spec ", "content": " Body ", "createdAt": "bad"}}, "folders": []map[string]any{{"id": "f1", "name": " Docs ", "color": "chartreuse"}}}})

	settings := readSettings(raw)

	if len(settings.Templates) != 1 || settings.Templates[0].Name != "Spec" || settings.Templates[0].Content != "Body" {
		t.Fatalf("templates = %#v", settings.Templates)
	}
	if len(settings.Folders) != 1 || settings.Folders[0].Color != "gray" {
		t.Fatalf("folders = %#v", settings.Folders)
	}
}

func TestParseTemplateRequiresNameAndContent(t *testing.T) {
	if _, err := parseTemplate(map[string]any{"name": "Runbook"}, Template{}); err == nil || err.Error() != "Template content is required" {
		t.Fatalf("expected content error, got %v", err)
	}
	got, err := parseTemplate(map[string]any{"name": "Runbook", "content": "Steps"}, Template{})
	if err != nil || got.Name != "Runbook" || got.Content != "Steps" {
		t.Fatalf("template = %#v err=%v", got, err)
	}
}

func TestParseFolderDefaultsInvalidColor(t *testing.T) {
	got, err := parseFolder(map[string]any{"name": "Specs", "color": "red"}, Folder{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Color != "gray" {
		t.Fatalf("color = %q", got.Color)
	}
}
