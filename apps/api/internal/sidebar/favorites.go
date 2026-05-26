package sidebar

import (
	"context"
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

type StoredFavorite struct {
	ObjectType string `json:"objectType"`
	ObjectID   string `json:"objectId"`
	CreatedAt  string `json:"createdAt"`
}

type Favorite struct {
	StoredFavorite
	ID      string  `json:"id"`
	Label   string  `json:"label"`
	Href    string  `json:"href"`
	Context *string `json:"context"`
}

type response struct {
	Favorites []Favorite `json:"favorites"`
}

type favoriteRequest struct {
	ObjectType string `json:"objectType"`
	ObjectID   string `json:"objectId"`
}

type reorderRequest struct {
	OrderedIDs []string `json:"orderedIds"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/favorites", h.List)
	r.Post("/favorites", h.Add)
	r.Patch("/favorites", h.Reorder)
	r.Delete("/favorites", h.Remove)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r.Context(), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "List sidebar favorites failed", err.Error())
		return
	}
	stored := readFavorites(settings, p.WorkspaceID)
	favorites, err := h.hydrate(r.Context(), p.WorkspaceID, stored)
	if err != nil {
		problem.Write(w, 500, "List sidebar favorites failed", err.Error())
		return
	}
	problem.JSON(w, 200, response{Favorites: favorites})
}

func (h Handler) Add(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r.Context(), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Add sidebar favorite failed", err.Error())
		return
	}
	var input favoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "objectType and objectId are required", err.Error())
		return
	}
	input.ObjectType = strings.TrimSpace(input.ObjectType)
	input.ObjectID = strings.TrimSpace(input.ObjectID)
	if !validObjectType(input.ObjectType) || input.ObjectID == "" {
		problem.Write(w, 400, "objectType and objectId are required", "")
		return
	}
	exists, err := h.targetExists(r.Context(), p.WorkspaceID, input.ObjectType, input.ObjectID)
	if err != nil {
		problem.Write(w, 500, "Add sidebar favorite failed", err.Error())
		return
	}
	if !exists {
		problem.Write(w, 404, "Favorite target not found", "")
		return
	}
	stored := readFavorites(settings, p.WorkspaceID)
	if !favoriteExists(stored, input.ObjectType, input.ObjectID) {
		stored = append(stored, StoredFavorite{ObjectType: input.ObjectType, ObjectID: input.ObjectID, CreatedAt: now()})
	}
	if err := h.writeFavorites(r.Context(), p.UserID, settings, p.WorkspaceID, stored); err != nil {
		problem.Write(w, 500, "Add sidebar favorite failed", err.Error())
		return
	}
	favorites, err := h.hydrate(r.Context(), p.WorkspaceID, stored)
	if err != nil {
		problem.Write(w, 500, "Add sidebar favorite failed", err.Error())
		return
	}
	problem.JSON(w, 201, response{Favorites: favorites})
}

func (h Handler) Reorder(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r.Context(), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Reorder sidebar favorites failed", err.Error())
		return
	}
	var input reorderRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.OrderedIDs == nil {
		problem.Write(w, 400, "orderedIds is required", "")
		return
	}
	stored := readFavorites(settings, p.WorkspaceID)
	byID := map[string]StoredFavorite{}
	for _, favorite := range stored {
		byID[favoriteID(favorite.ObjectType, favorite.ObjectID)] = favorite
	}
	next := []StoredFavorite{}
	for _, id := range input.OrderedIDs {
		favorite, ok := byID[id]
		if !ok {
			continue
		}
		next = append(next, favorite)
		delete(byID, id)
	}
	for _, favorite := range stored {
		if _, ok := byID[favoriteID(favorite.ObjectType, favorite.ObjectID)]; ok {
			next = append(next, favorite)
			delete(byID, favoriteID(favorite.ObjectType, favorite.ObjectID))
		}
	}
	if err := h.writeFavorites(r.Context(), p.UserID, settings, p.WorkspaceID, next); err != nil {
		problem.Write(w, 500, "Reorder sidebar favorites failed", err.Error())
		return
	}
	favorites, err := h.hydrate(r.Context(), p.WorkspaceID, next)
	if err != nil {
		problem.Write(w, 500, "Reorder sidebar favorites failed", err.Error())
		return
	}
	problem.JSON(w, 200, response{Favorites: favorites})
}

func (h Handler) Remove(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r.Context(), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Remove sidebar favorite failed", err.Error())
		return
	}
	objectType := strings.TrimSpace(r.URL.Query().Get("objectType"))
	objectID := strings.TrimSpace(r.URL.Query().Get("objectId"))
	if !validObjectType(objectType) || objectID == "" {
		problem.Write(w, 400, "objectType and objectId are required", "")
		return
	}
	stored := readFavorites(settings, p.WorkspaceID)
	next := []StoredFavorite{}
	for _, favorite := range stored {
		if favorite.ObjectType != objectType || favorite.ObjectID != objectID {
			next = append(next, favorite)
		}
	}
	if err := h.writeFavorites(r.Context(), p.UserID, settings, p.WorkspaceID, next); err != nil {
		problem.Write(w, 500, "Remove sidebar favorite failed", err.Error())
		return
	}
	favorites, err := h.hydrate(r.Context(), p.WorkspaceID, next)
	if err != nil {
		problem.Write(w, 500, "Remove sidebar favorite failed", err.Error())
		return
	}
	problem.JSON(w, 200, response{Favorites: favorites})
}

func (h Handler) userSettings(ctx context.Context, userID string) ([]byte, error) {
	var settings []byte
	err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from "user" where id=$1 limit 1`, userID).Scan(&settings)
	return settings, err
}

func (h Handler) writeFavorites(ctx context.Context, userID string, settings []byte, workspaceID string, favorites []StoredFavorite) error {
	root := map[string]any{}
	_ = json.Unmarshal(settings, &root)
	byWorkspace, _ := root["sidebarFavoritesByWorkspace"].(map[string]any)
	if byWorkspace == nil {
		byWorkspace = map[string]any{}
	}
	if len(favorites) > 50 {
		favorites = favorites[:50]
	}
	byWorkspace[workspaceID] = favorites
	root["sidebarFavoritesByWorkspace"] = byWorkspace
	body, _ := json.Marshal(root)
	_, err := h.DB.Exec(ctx, `update "user" set settings=$1::jsonb, updated_at=now() where id=$2`, body, userID)
	return err
}

func (h Handler) targetExists(ctx context.Context, workspaceID, objectType, objectID string) (bool, error) {
	var one int
	var err error
	switch objectType {
	case "project":
		err = h.DB.QueryRow(ctx, `select 1 from project where workspace_id=$1::uuid and id=$2::uuid limit 1`, workspaceID, objectID).Scan(&one)
	case "issue":
		err = h.DB.QueryRow(ctx, `select 1 from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and i.id=$2::uuid limit 1`, workspaceID, objectID).Scan(&one)
	case "view":
		err = h.DB.QueryRow(ctx, `select 1 from custom_view where workspace_id=$1::uuid and id=$2::uuid limit 1`, workspaceID, objectID).Scan(&one)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (h Handler) hydrate(ctx context.Context, workspaceID string, stored []StoredFavorite) ([]Favorite, error) {
	favorites := []Favorite{}
	for _, favorite := range stored {
		hydrated, ok, err := h.hydrateOne(ctx, workspaceID, favorite)
		if err != nil {
			return nil, err
		}
		if ok {
			favorites = append(favorites, hydrated)
		}
	}
	return favorites, nil
}

func (h Handler) hydrateOne(ctx context.Context, workspaceID string, favorite StoredFavorite) (Favorite, bool, error) {
	out := Favorite{StoredFavorite: favorite, ID: favoriteID(favorite.ObjectType, favorite.ObjectID)}
	switch favorite.ObjectType {
	case "project":
		var name, slug string
		var icon *string
		err := h.DB.QueryRow(ctx, `select name, slug, icon from project where workspace_id=$1::uuid and id=$2::uuid limit 1`, workspaceID, favorite.ObjectID).Scan(&name, &slug, &icon)
		if errors.Is(err, pgx.ErrNoRows) {
			return Favorite{}, false, nil
		}
		if err != nil {
			return Favorite{}, false, err
		}
		out.Label = name
		out.Href = "/project/" + slug
		context := "Project"
		out.Context = &context
	case "issue":
		var identifier, title string
		err := h.DB.QueryRow(ctx, `select i.identifier, i.title from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and i.id=$2::uuid limit 1`, workspaceID, favorite.ObjectID).Scan(&identifier, &title)
		if errors.Is(err, pgx.ErrNoRows) {
			return Favorite{}, false, nil
		}
		if err != nil {
			return Favorite{}, false, err
		}
		out.Label = identifier
		out.Href = "/issue/" + identifier
		out.Context = &title
	case "view":
		var name string
		var teamKey *string
		err := h.DB.QueryRow(ctx, `select cv.name, t.key from custom_view cv left join team t on t.id=cv.team_id where cv.workspace_id=$1::uuid and cv.id=$2::uuid limit 1`, workspaceID, favorite.ObjectID).Scan(&name, &teamKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return Favorite{}, false, nil
		}
		if err != nil {
			return Favorite{}, false, err
		}
		out.Label = name
		if teamKey != nil {
			out.Href = "/team/" + *teamKey + "/views"
			context := *teamKey + " view"
			out.Context = &context
		} else {
			out.Href = "/views"
			context := "Workspace view"
			out.Context = &context
		}
	}
	return out, true, nil
}

func readFavorites(settings []byte, workspaceID string) []StoredFavorite {
	root := map[string]any{}
	_ = json.Unmarshal(settings, &root)
	byWorkspace, _ := root["sidebarFavoritesByWorkspace"].(map[string]any)
	raw, _ := byWorkspace[workspaceID].([]any)
	seen := map[string]bool{}
	favorites := []StoredFavorite{}
	for _, value := range raw {
		record, ok := value.(map[string]any)
		if !ok {
			continue
		}
		favorite := StoredFavorite{ObjectType: strings.TrimSpace(stringValue(record["objectType"])), ObjectID: strings.TrimSpace(stringValue(record["objectId"])), CreatedAt: strings.TrimSpace(stringValue(record["createdAt"]))}
		if !validObjectType(favorite.ObjectType) || favorite.ObjectID == "" {
			continue
		}
		if favorite.CreatedAt == "" {
			favorite.CreatedAt = time.Unix(0, 0).UTC().Format(time.RFC3339)
		}
		id := favoriteID(favorite.ObjectType, favorite.ObjectID)
		if seen[id] {
			continue
		}
		seen[id] = true
		favorites = append(favorites, favorite)
		if len(favorites) == 50 {
			break
		}
	}
	return favorites
}

func favoriteID(objectType, objectID string) string { return objectType + ":" + objectID }
func validObjectType(value string) bool {
	return value == "project" || value == "issue" || value == "view"
}
func favoriteExists(favorites []StoredFavorite, objectType, objectID string) bool {
	for _, favorite := range favorites {
		if favorite.ObjectType == objectType && favorite.ObjectID == objectID {
			return true
		}
	}
	return false
}
func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}
func now() string { return time.Now().UTC().Format(time.RFC3339) }
