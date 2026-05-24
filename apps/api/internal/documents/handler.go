package documents

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Template struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Folder struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Color       string `json:"color"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Settings struct {
	Templates                []Template `json:"templates"`
	Folders                  []Folder   `json:"folders"`
	DefaultVisibility        string     `json:"defaultVisibility"`
	AutoLinkProjectDocuments bool       `json:"autoLinkProjectDocuments"`
}

type access struct {
	WorkspaceID string
	Settings    []byte
	Role        string
}

var folderColors = map[string]bool{"gray": true, "blue": true, "green": true, "yellow": true, "orange": true, "purple": true, "pink": true}

func (h Handler) SettingsRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.GetSettings)
	r.Patch("/", h.UpdateSettings)
	return r
}

func (h Handler) FolderRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.CreateFolder)
	r.Patch("/{id}", h.UpdateFolder)
	r.Delete("/{id}", h.DeleteFolder)
	return r
}

func (h Handler) TemplateRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.CreateTemplate)
	r.Patch("/{id}", h.UpdateTemplate)
	r.Delete("/{id}", h.DeleteTemplate)
	return r
}

func (h Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	access, err := h.workspaceAccess(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load document settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]Settings{"documents": readSettings(access.Settings)})
}

func (h Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	access, ok := h.requireManager(w, r)
	if !ok {
		return
	}
	var body map[string]any
	if !decodeBody(w, r, &body) {
		return
	}
	documents := readSettings(access.Settings)
	if raw, ok := body["defaultVisibility"]; ok {
		visibility, _ := raw.(string)
		visibility = strings.TrimSpace(visibility)
		if visibility != "workspace" && visibility != "private" {
			problem.Write(w, 400, "Default document visibility must be workspace or private", "")
			return
		}
		documents.DefaultVisibility = visibility
	}
	if raw, ok := body["autoLinkProjectDocuments"]; ok {
		value, ok := raw.(bool)
		if !ok {
			problem.Write(w, 400, "Auto-link project documents must be a boolean", "")
			return
		}
		documents.AutoLinkProjectDocuments = value
	}
	if err := h.persist(r.Context(), access, documents); err != nil {
		problem.Write(w, 500, "Update document settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]Settings{"documents": documents})
}

func (h Handler) CreateFolder(w http.ResponseWriter, r *http.Request) {
	h.mutateFolder(w, r, "create")
}
func (h Handler) UpdateFolder(w http.ResponseWriter, r *http.Request) {
	h.mutateFolder(w, r, "update")
}
func (h Handler) DeleteFolder(w http.ResponseWriter, r *http.Request) {
	h.mutateFolder(w, r, "delete")
}

func (h Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	h.mutateTemplate(w, r, "create")
}
func (h Handler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	h.mutateTemplate(w, r, "update")
}
func (h Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	h.mutateTemplate(w, r, "delete")
}

func (h Handler) mutateFolder(w http.ResponseWriter, r *http.Request, op string) {
	access, ok := h.requireManager(w, r)
	if !ok {
		return
	}
	documents := readSettings(access.Settings)
	id := chi.URLParam(r, "id")
	if op == "delete" {
		idx := folderIndex(documents.Folders, id)
		if idx < 0 {
			problem.Write(w, 404, "Folder not found", "")
			return
		}
		documents.Folders = append(documents.Folders[:idx], documents.Folders[idx+1:]...)
		if err := h.persist(r.Context(), access, documents); err != nil {
			problem.Write(w, 500, "Delete folder failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]bool{"success": true})
		return
	}
	var body map[string]any
	if !decodeBody(w, r, &body) {
		return
	}
	existing := Folder{}
	if op == "update" {
		idx := folderIndex(documents.Folders, id)
		if idx < 0 {
			problem.Write(w, 404, "Folder not found", "")
			return
		}
		existing = documents.Folders[idx]
		folder, err := parseFolder(body, existing)
		if err != nil {
			problem.Write(w, 400, err.Error(), "")
			return
		}
		folder.ID = existing.ID
		folder.CreatedAt = existing.CreatedAt
		folder.UpdatedAt = now()
		documents.Folders[idx] = folder
		if err := h.persist(r.Context(), access, documents); err != nil {
			problem.Write(w, 500, "Update folder failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]Folder{"folder": folder})
		return
	}
	folder, err := parseFolder(body, Folder{})
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	stamp := now()
	folder.ID = newID()
	folder.CreatedAt = stamp
	folder.UpdatedAt = stamp
	documents.Folders = append([]Folder{folder}, documents.Folders...)
	if err := h.persist(r.Context(), access, documents); err != nil {
		problem.Write(w, 500, "Create folder failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]Folder{"folder": folder})
}

func (h Handler) mutateTemplate(w http.ResponseWriter, r *http.Request, op string) {
	access, ok := h.requireManager(w, r)
	if !ok {
		return
	}
	documents := readSettings(access.Settings)
	id := chi.URLParam(r, "id")
	if op == "delete" {
		idx := templateIndex(documents.Templates, id)
		if idx < 0 {
			problem.Write(w, 404, "Template not found", "")
			return
		}
		documents.Templates = append(documents.Templates[:idx], documents.Templates[idx+1:]...)
		if err := h.persist(r.Context(), access, documents); err != nil {
			problem.Write(w, 500, "Delete template failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]bool{"success": true})
		return
	}
	var body map[string]any
	if !decodeBody(w, r, &body) {
		return
	}
	if op == "update" {
		idx := templateIndex(documents.Templates, id)
		if idx < 0 {
			problem.Write(w, 404, "Template not found", "")
			return
		}
		existing := documents.Templates[idx]
		template, err := parseTemplate(body, existing)
		if err != nil {
			problem.Write(w, 400, err.Error(), "")
			return
		}
		template.ID = existing.ID
		template.CreatedAt = existing.CreatedAt
		template.UpdatedAt = now()
		documents.Templates[idx] = template
		if err := h.persist(r.Context(), access, documents); err != nil {
			problem.Write(w, 500, "Update template failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]Template{"template": template})
		return
	}
	template, err := parseTemplate(body, Template{})
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	stamp := now()
	template.ID = newID()
	template.CreatedAt = stamp
	template.UpdatedAt = stamp
	documents.Templates = append([]Template{template}, documents.Templates...)
	if err := h.persist(r.Context(), access, documents); err != nil {
		problem.Write(w, 500, "Create template failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]Template{"template": template})
}

func (h Handler) requireManager(w http.ResponseWriter, r *http.Request) (access, bool) {
	p, _ := auth.FromContext(r.Context())
	access, err := h.workspaceAccess(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return access, false
	}
	if err != nil {
		problem.Write(w, 500, "Load document settings failed", err.Error())
		return access, false
	}
	if access.Role != "owner" && access.Role != "admin" {
		problem.Write(w, 403, "Forbidden", "")
		return access, false
	}
	return access, true
}

func (h Handler) workspaceAccess(ctx context.Context, p auth.Principal) (access, error) {
	var a access
	err := h.DB.QueryRow(ctx, `select w.id::text, coalesce(w.settings,'{}'::jsonb), m.role::text from workspace w join member m on m.workspace_id=w.id and m.user_id=$1 where w.id=$2::uuid`, p.UserID, p.WorkspaceID).Scan(&a.WorkspaceID, &a.Settings, &a.Role)
	return a, err
}

func (h Handler) persist(ctx context.Context, access access, documents Settings) error {
	root := map[string]any{}
	_ = json.Unmarshal(access.Settings, &root)
	root["documents"] = documents
	body, _ := json.Marshal(root)
	_, err := h.DB.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, access.WorkspaceID)
	return err
}

func readSettings(raw []byte) Settings {
	root := map[string]any{}
	_ = json.Unmarshal(raw, &root)
	documents, _ := root["documents"].(map[string]any)
	settings := Settings{Templates: []Template{}, Folders: []Folder{}, DefaultVisibility: "workspace", AutoLinkProjectDocuments: true}
	if visibility := readString(documents, "defaultVisibility", "workspace"); visibility == "private" {
		settings.DefaultVisibility = "private"
	}
	if value, ok := documents["autoLinkProjectDocuments"].(bool); ok {
		settings.AutoLinkProjectDocuments = value
	}
	if values, ok := documents["templates"].([]any); ok {
		for _, value := range values {
			if template, ok := normalizeTemplate(value); ok {
				settings.Templates = append(settings.Templates, template)
			}
		}
	}
	if values, ok := documents["folders"].([]any); ok {
		for _, value := range values {
			if folder, ok := normalizeFolder(value); ok {
				settings.Folders = append(settings.Folders, folder)
			}
		}
	}
	return settings
}

func normalizeTemplate(value any) (Template, bool) {
	record := asRecord(value)
	id := readString(record, "id", "")
	name := readString(record, "name", "")
	if id == "" || name == "" {
		return Template{}, false
	}
	stamp := now()
	return Template{ID: id, Name: name, Description: readString(record, "description", ""), Content: readString(record, "content", ""), CreatedAt: timestamp(readString(record, "createdAt", ""), stamp), UpdatedAt: timestamp(readString(record, "updatedAt", ""), stamp)}, true
}

func normalizeFolder(value any) (Folder, bool) {
	record := asRecord(value)
	id := readString(record, "id", "")
	name := readString(record, "name", "")
	if id == "" || name == "" {
		return Folder{}, false
	}
	stamp := now()
	color := readString(record, "color", "gray")
	if !folderColors[color] {
		color = "gray"
	}
	return Folder{ID: id, Name: name, Description: readString(record, "description", ""), Color: color, CreatedAt: timestamp(readString(record, "createdAt", ""), stamp), UpdatedAt: timestamp(readString(record, "updatedAt", ""), stamp)}, true
}

func parseTemplate(body map[string]any, existing Template) (Template, error) {
	name := chooseString(body, "name", existing.Name)
	description := chooseString(body, "description", existing.Description)
	content := chooseString(body, "content", existing.Content)
	if name == "" {
		return Template{}, errors.New("Template name is required")
	}
	if content == "" {
		return Template{}, errors.New("Template content is required")
	}
	return Template{Name: name, Description: description, Content: content}, nil
}

func parseFolder(body map[string]any, existing Folder) (Folder, error) {
	name := chooseString(body, "name", existing.Name)
	description := chooseString(body, "description", existing.Description)
	color := chooseString(body, "color", existing.Color)
	if color == "" || !folderColors[color] {
		color = "gray"
	}
	if name == "" {
		return Folder{}, errors.New("Folder name is required")
	}
	return Folder{Name: name, Description: description, Color: color}, nil
}

func decodeBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	if err := json.NewDecoder(r.Body).Decode(dest); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return false
	}
	return true
}

func asRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func readString(record map[string]any, key, fallback string) string {
	if value, ok := record[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return fallback
}

func chooseString(record map[string]any, key, fallback string) string {
	if _, ok := record[key]; !ok {
		return strings.TrimSpace(fallback)
	}
	return readString(record, key, "")
}

func timestamp(value, fallback string) string {
	if _, err := time.Parse(time.RFC3339, value); err == nil {
		return value
	}
	return fallback
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func folderIndex(folders []Folder, id string) int {
	for i, folder := range folders {
		if folder.ID == id {
			return i
		}
	}
	return -1
}

func templateIndex(templates []Template, id string) int {
	for i, template := range templates {
		if template.ID == id {
			return i
		}
	}
	return -1
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strings.ReplaceAll(now(), ":", "")
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(b[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
