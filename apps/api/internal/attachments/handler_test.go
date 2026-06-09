package attachments

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
)

type fakePresigner struct {
	putBucket      string
	putKey         string
	putContentType string
	putExpires     time.Duration
	putHeaders     map[string]string
	putErr         error
}

func (f *fakePresigner) PresignPut(_ context.Context, bucket, key, contentType string, expires time.Duration) (string, map[string]string, error) {
	f.putBucket = bucket
	f.putKey = key
	f.putContentType = contentType
	f.putExpires = expires
	if f.putHeaders == nil {
		f.putHeaders = map[string]string{"Content-Type": contentType}
	}
	return "https://uploads.test/" + key, f.putHeaders, f.putErr
}

func (f *fakePresigner) PresignGet(_ context.Context, bucket, key string, expires time.Duration) (string, error) {
	return "https://downloads.test/" + bucket + "/" + key, nil
}

func TestStorageKeyScopesAndSanitizesFileName(t *testing.T) {
	key := storageKey("workspace-123", "../quarterly report (final).pdf")

	if !strings.HasPrefix(key, "workspaces/workspace-123/attachments/") {
		t.Fatalf("key prefix = %q", key)
	}
	if strings.Contains(key, "..") || strings.Contains(strings.TrimPrefix(key, "workspaces/workspace-123/attachments/"), "/") {
		t.Fatalf("key was not path sanitized: %q", key)
	}
	if !strings.HasSuffix(key, "-quarterly-report-final-.pdf") {
		t.Fatalf("key suffix = %q", key)
	}
}

func TestCreatePresignedUploadUsesWorkspaceScopedKeyAndDefaultContentType(t *testing.T) {
	presigner := &fakePresigner{}
	handler := Handler{Bucket: "attachments-bucket", Presigner: presigner}
	req := httptest.NewRequest(http.MethodPost, "/attachments/presigned-upload", strings.NewReader(`{"fileName":" notes.txt ","size":12}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithPrincipal(req.Context(), auth.Principal{WorkspaceID: "workspace-abc", UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.CreatePresignedUpload(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if presigner.putBucket != "attachments-bucket" {
		t.Fatalf("bucket = %q", presigner.putBucket)
	}
	if !strings.HasPrefix(presigner.putKey, "workspaces/workspace-abc/attachments/") || !strings.HasSuffix(presigner.putKey, "-notes.txt") {
		t.Fatalf("key = %q", presigner.putKey)
	}
	if presigner.putContentType != "application/octet-stream" {
		t.Fatalf("content type = %q", presigner.putContentType)
	}
	if presigner.putExpires != 15*time.Minute {
		t.Fatalf("expires = %s", presigner.putExpires)
	}

	var body presignUploadResponse
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Method != http.MethodPut || body.ExpiresIn != 900 || body.ContentType != "application/octet-stream" {
		t.Fatalf("response = %#v", body)
	}
	if body.StorageKey != presigner.putKey {
		t.Fatalf("storage key response = %q want %q", body.StorageKey, presigner.putKey)
	}
}

func TestCreatePresignedUploadRequiresConfiguredBucket(t *testing.T) {
	t.Setenv("S3_BUCKET", "")
	handler := Handler{Presigner: &fakePresigner{}}
	req := httptest.NewRequest(http.MethodPost, "/attachments/presigned-upload", strings.NewReader(`{"fileName":"notes.txt"}`))
	req = req.WithContext(auth.WithPrincipal(req.Context(), auth.Principal{WorkspaceID: "workspace-abc", UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.CreatePresignedUpload(recorder, req)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}
