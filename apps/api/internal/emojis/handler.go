package emojis

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

const maxEmojis = 100
const maxNameLength = 32
const maxImageURLLength = 250_000

var emojiNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

type Handler struct{ DB *pgxpool.Pool }

type CustomEmoji struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ImageURL  string `json:"imageUrl"`
	CreatedAt string `json:"createdAt"`
}

type listResponse struct {
	Emojis []CustomEmoji `json:"emojis"`
}

type createRequest struct {
	Name     any `json:"name"`
	ImageURL any `json:"imageUrl"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "List custom emojis failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Emojis: readCustomEmojis(settings)})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create custom emoji failed", err.Error())
		return
	}
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name, imageURL, msg := validateInput(input.Name, input.ImageURL)
	if msg != "" {
		problem.Write(w, 400, msg, "")
		return
	}
	emojis := readCustomEmojis(settings)
	if len(emojis) >= maxEmojis {
		problem.Write(w, 400, "Custom emoji limit reached", "")
		return
	}
	for _, emoji := range emojis {
		if emoji.Name == name {
			problem.Write(w, 409, "A custom emoji with this name already exists", "")
			return
		}
	}
	emoji := CustomEmoji{ID: randomID(), Name: name, ImageURL: imageURL, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	next := asSettingsMap(settings)
	next["customEmojis"] = append(emojis, emoji)
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create custom emoji failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := h.updateSettings(r.Context(), tx, p.WorkspaceID, next); err != nil {
		problem.Write(w, 500, "Create custom emoji failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "custom_emoji", emoji.ID, "created", emoji, p.UserID); err != nil {
		problem.Write(w, 500, "Create custom emoji failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create custom emoji failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]CustomEmoji{"emoji": emoji})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete custom emoji failed", err.Error())
		return
	}
	id := chi.URLParam(r, "id")
	emojis := readCustomEmojis(settings)
	nextEmojis := make([]CustomEmoji, 0, len(emojis))
	var deleted *CustomEmoji
	for _, emoji := range emojis {
		if emoji.ID == id {
			copy := emoji
			deleted = &copy
			continue
		}
		nextEmojis = append(nextEmojis, emoji)
	}
	if deleted == nil {
		problem.Write(w, 404, "Custom emoji not found", "")
		return
	}
	next := asSettingsMap(settings)
	next["customEmojis"] = nextEmojis
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete custom emoji failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := h.updateSettings(r.Context(), tx, p.WorkspaceID, next); err != nil {
		problem.Write(w, 500, "Delete custom emoji failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "custom_emoji", id, "deleted", deleted, p.UserID); err != nil {
		problem.Write(w, 500, "Delete custom emoji failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete custom emoji failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"ok": true})
}

func (h Handler) workspaceSettings(ctx context.Context, workspaceID string) ([]byte, error) {
	var settings []byte
	err := h.DB.QueryRow(ctx, `select coalesce(settings, '{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&settings)
	return settings, err
}

func (h Handler) updateSettings(ctx context.Context, tx pgx.Tx, workspaceID string, settings map[string]any) error {
	body, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, workspaceID)
	return err
}

func validateInput(rawName any, rawURL any) (string, string, string) {
	name := normalizeName(rawName)
	if name == "" {
		return "", "", "Emoji name is required"
	}
	if len(name) > maxNameLength || !emojiNamePattern.MatchString(name) {
		return "", "", "Emoji name must be 1-32 lowercase letters, numbers, underscores, or hyphens"
	}
	imageURL, ok := rawURL.(string)
	if !ok || !isSupportedImageURL(imageURL) {
		return "", "", "A PNG, JPG, GIF, WebP, SVG data URL or image URL is required"
	}
	return name, imageURL, ""
}

func normalizeName(value any) string {
	name, ok := value.(string)
	if !ok {
		return ""
	}
	name = strings.TrimSpace(strings.ToLower(name))
	return strings.Trim(name, ":")
}

func isSupportedImageURL(value string) bool {
	if value == "" || len(value) > maxImageURLLength {
		return false
	}
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "data:image/png;base64,") || strings.HasPrefix(lower, "data:image/jpeg;base64,") || strings.HasPrefix(lower, "data:image/jpg;base64,") || strings.HasPrefix(lower, "data:image/webp;base64,") || strings.HasPrefix(lower, "data:image/gif;base64,") || strings.HasPrefix(lower, "data:image/svg+xml;base64,")
}

func readCustomEmojis(raw []byte) []CustomEmoji {
	settings := asSettingsMap(raw)
	values, ok := settings["customEmojis"].([]any)
	if !ok {
		return []CustomEmoji{}
	}
	emojis := []CustomEmoji{}
	for _, value := range values {
		record, ok := value.(map[string]any)
		if !ok {
			continue
		}
		emoji := CustomEmoji{}
		if id, ok := record["id"].(string); ok {
			emoji.ID = id
		}
		if name, ok := record["name"].(string); ok {
			emoji.Name = name
		}
		if imageURL, ok := record["imageUrl"].(string); ok {
			emoji.ImageURL = imageURL
		}
		if createdAt, ok := record["createdAt"].(string); ok {
			emoji.CreatedAt = createdAt
		}
		if emoji.ID != "" && emojiNamePattern.MatchString(emoji.Name) && isSupportedImageURL(emoji.ImageURL) && emoji.CreatedAt != "" {
			emojis = append(emojis, emoji)
		}
	}
	sort.Slice(emojis, func(i, j int) bool { return emojis[i].Name < emojis[j].Name })
	return emojis
}

func asSettingsMap(raw []byte) map[string]any {
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	return settings
}

func randomID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "emoji_" + hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return "emoji_" + hex.EncodeToString(buf)
}

func insertOperation(ctx context.Context, tx pgx.Tx, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	return syncapi.InsertOperation(ctx, tx, workspaceID, entityType, entityID, opType, payload, createdBy)
}
