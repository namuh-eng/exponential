package attachments

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct {
	DB        *pgxpool.Pool
	Presigner ObjectPresigner
	Bucket    string
}

type ObjectPresigner interface {
	PresignPut(ctx context.Context, bucket, key, contentType string, expires time.Duration) (string, map[string]string, error)
	PresignGet(ctx context.Context, bucket, key string, expires time.Duration) (string, error)
}

type presignUploadRequest struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type presignUploadResponse struct {
	UploadURL   string            `json:"uploadUrl"`
	StorageKey  string            `json:"storageKey"`
	Headers     map[string]string `json:"headers"`
	ExpiresIn   int               `json:"expiresIn"`
	Method      string            `json:"method"`
	ContentType string            `json:"contentType"`
}

type downloadURLResponse struct {
	DownloadURL string `json:"downloadUrl"`
	ExpiresIn   int    `json:"expiresIn"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/presigned-upload", h.CreatePresignedUpload)
	r.Get("/{id}/download-url", h.GetDownloadURL)
	return r
}

func (h Handler) CreatePresignedUpload(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.FromContext(r.Context())
	if !ok || strings.TrimSpace(principal.WorkspaceID) == "" {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	var input presignUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		problem.Write(w, http.StatusBadRequest, "Attachment file name is required", "")
		return
	}
	if input.Size < 0 {
		problem.Write(w, http.StatusBadRequest, "Attachment size is invalid", "")
		return
	}
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	bucket := h.bucket()
	if bucket == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Attachment storage is not configured", "S3_BUCKET is required")
		return
	}
	key := storageKey(principal.WorkspaceID, fileName)
	expires := 15 * time.Minute
	url, headers, err := h.presigner().PresignPut(r.Context(), bucket, key, contentType, expires)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create attachment upload URL failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, presignUploadResponse{UploadURL: url, StorageKey: key, Headers: headers, ExpiresIn: int(expires.Seconds()), Method: http.MethodPut, ContentType: contentType})
}

func (h Handler) GetDownloadURL(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.FromContext(r.Context())
	if !ok || strings.TrimSpace(principal.WorkspaceID) == "" {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "")
		return
	}
	bucket := h.bucket()
	if bucket == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Attachment storage is not configured", "S3_BUCKET is required")
		return
	}
	storageKey, err := h.lookupStorageKey(r.Context(), chi.URLParam(r, "id"), principal.WorkspaceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			problem.Write(w, http.StatusNotFound, "Attachment not found", "")
			return
		}
		problem.Write(w, http.StatusInternalServerError, "Get attachment download URL failed", err.Error())
		return
	}
	expires := 15 * time.Minute
	url, err := h.presigner().PresignGet(r.Context(), bucket, storageKey, expires)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get attachment download URL failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, downloadURLResponse{DownloadURL: url, ExpiresIn: int(expires.Seconds())})
}

func (h Handler) lookupStorageKey(ctx context.Context, id string, workspaceID string) (string, error) {
	var storageKey string
	err := h.DB.QueryRow(ctx, `
		select ca.storage_key
		from comment_attachment ca
		join comment c on c.id = ca.comment_id
		join issue i on i.id = c.issue_id
		join team t on t.id = i.team_id
		where ca.id = $1::uuid and t.workspace_id = $2::uuid
		limit 1`, id, workspaceID).Scan(&storageKey)
	return storageKey, err
}

func (h Handler) bucket() string {
	if strings.TrimSpace(h.Bucket) != "" {
		return strings.TrimSpace(h.Bucket)
	}
	return strings.TrimSpace(os.Getenv("S3_BUCKET"))
}

func (h Handler) presigner() ObjectPresigner {
	if h.Presigner != nil {
		return h.Presigner
	}
	return defaultS3Presigner{}
}

type defaultS3Presigner struct{}

func (defaultS3Presigner) client(ctx context.Context) (*s3.PresignClient, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	return s3.NewPresignClient(s3.NewFromConfig(cfg)), nil
}

func (p defaultS3Presigner) PresignPut(ctx context.Context, bucket, key, contentType string, expires time.Duration) (string, map[string]string, error) {
	client, err := p.client(ctx)
	if err != nil {
		return "", nil, err
	}
	request, err := client.PresignPutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), ContentType: aws.String(contentType)}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", nil, err
	}
	return request.URL, map[string]string{"Content-Type": contentType}, nil
}

func (p defaultS3Presigner) PresignGet(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	client, err := p.client(ctx)
	if err != nil {
		return "", err
	}
	request, err := client.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", err
	}
	return request.URL, nil
}

var unsafeKeyChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func storageKey(workspaceID, fileName string) string {
	base := filepath.Base(strings.TrimSpace(fileName))
	base = unsafeKeyChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, ".-")
	if base == "" {
		base = "attachment"
	}
	return "workspaces/" + workspaceID + "/attachments/" + uuid.NewString() + "-" + base
}
