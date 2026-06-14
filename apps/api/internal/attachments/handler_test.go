package attachments

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
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

func TestDefaultS3PresignerUsesPathStyleCustomEndpoint(t *testing.T) {
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "minioadmin")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "minioadmin")
	t.Setenv("S3_ENDPOINT", "http://localhost:9000")

	signedURL, headers, err := defaultS3Presigner{}.PresignPut(
		context.Background(),
		"attachments",
		"workspaces/ws-1/attachments/file.txt",
		"text/plain",
		time.Minute,
	)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	parsed, err := url.Parse(signedURL)
	if err != nil {
		t.Fatalf("parse signed url: %v", err)
	}
	if parsed.Host != "localhost:9000" {
		t.Fatalf("host = %q", parsed.Host)
	}
	if parsed.Path != "/attachments/workspaces/ws-1/attachments/file.txt" {
		t.Fatalf("path = %q", parsed.Path)
	}
	if headers["Content-Type"] != "text/plain" {
		t.Fatalf("headers = %#v", headers)
	}
}

func TestDefaultS3PresignerKeepsAWSVirtualHostStyleWithoutEndpoint(t *testing.T) {
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "aws-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "aws-secret-key")
	t.Setenv("S3_ENDPOINT", "")

	signedURL, err := defaultS3Presigner{}.PresignGet(
		context.Background(),
		"attachments-bucket",
		"workspaces/ws-1/attachments/file.txt",
		time.Minute,
	)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	parsed, err := url.Parse(signedURL)
	if err != nil {
		t.Fatalf("parse signed url: %v", err)
	}
	if !strings.HasPrefix(parsed.Host, "attachments-bucket.s3.") {
		t.Fatalf("host = %q", parsed.Host)
	}
	if parsed.Path != "/workspaces/ws-1/attachments/file.txt" {
		t.Fatalf("path = %q", parsed.Path)
	}
}

func TestDefaultS3PresignerMinIOSmoke(t *testing.T) {
	endpoint := strings.TrimSpace(os.Getenv("ATTACHMENTS_MINIO_SMOKE_ENDPOINT"))
	if endpoint == "" {
		t.Skip("set ATTACHMENTS_MINIO_SMOKE_ENDPOINT to run the MinIO presign smoke test")
	}
	bucket := strings.TrimSpace(os.Getenv("ATTACHMENTS_MINIO_SMOKE_BUCKET"))
	if bucket == "" {
		bucket = "exponential-attachments"
	}
	accessKey := strings.TrimSpace(os.Getenv("ATTACHMENTS_MINIO_SMOKE_ACCESS_KEY"))
	if accessKey == "" {
		accessKey = "minioadmin"
	}
	secretKey := strings.TrimSpace(os.Getenv("ATTACHMENTS_MINIO_SMOKE_SECRET_KEY"))
	if secretKey == "" {
		secretKey = "minioadmin"
	}
	body := "minio presigned attachment smoke"
	key := "workspaces/smoke/attachments/" + uuid.NewString() + "-smoke.txt"

	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", accessKey)
	t.Setenv("AWS_SECRET_ACCESS_KEY", secretKey)
	t.Setenv("S3_ENDPOINT", endpoint)

	presigner := defaultS3Presigner{}
	putURL, headers, err := presigner.PresignPut(context.Background(), bucket, key, "text/plain", time.Minute)
	if err != nil {
		t.Fatalf("presign put: %v", err)
	}
	putRequest, err := http.NewRequest(http.MethodPut, putURL, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build put request: %v", err)
	}
	for name, value := range headers {
		putRequest.Header.Set(name, value)
	}
	putResponse, err := http.DefaultClient.Do(putRequest)
	if err != nil {
		t.Fatalf("put object: %v", err)
	}
	_ = putResponse.Body.Close()
	if putResponse.StatusCode < 200 || putResponse.StatusCode >= 300 {
		t.Fatalf("put status = %d", putResponse.StatusCode)
	}

	getURL, err := presigner.PresignGet(context.Background(), bucket, key, time.Minute)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	getResponse, err := http.Get(getURL)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	defer getResponse.Body.Close()
	if getResponse.StatusCode != http.StatusOK {
		t.Fatalf("get status = %d", getResponse.StatusCode)
	}
	got, err := io.ReadAll(getResponse.Body)
	if err != nil {
		t.Fatalf("read object: %v", err)
	}
	if string(got) != body {
		t.Fatalf("body = %q", string(got))
	}
}
