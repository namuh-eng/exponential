package testhelpers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/authorized-application", h.CreateAuthorizedApplication)
	r.Delete("/authorized-application", h.ClearAuthorizedApplications)
	r.Post("/slack-integration", h.CreateSlackIntegration)
	r.Delete("/slack-integration", h.DeleteSlackIntegration)
	return r
}

func allowed() bool { return os.Getenv("NODE_ENV") == "test" || os.Getenv("PLAYWRIGHT_TEST") == "true" }

func (h Handler) CreateAuthorizedApplication(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	var body struct {
		Action string   `json:"action"`
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Action == "clear" {
		_, _ = h.DB.Exec(r.Context(), `delete from authorized_application_grant where user_id=$1`, p.UserID)
		problem.JSON(w, 200, map[string]bool{"success": true})
		return
	}
	id := helperID("grant")
	appID := helperID("app")
	clientID := "lin_" + randomHex(12)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "E2E OAuth App"
	}
	scopes := body.Scopes
	if len(scopes) == 0 {
		scopes = []string{"read", "write"}
	}
	raw, _ := json.Marshal(scopes)
	_, err := h.DB.Exec(r.Context(), `insert into authorized_application_grant (id,user_id,app_id,client_id,name,image_url,scopes,webhooks_enabled) values ($1,$2,$3,$4,$5,null,$6::jsonb,true)`, id, p.UserID, appID, clientID, name, raw)
	if err != nil {
		problem.Write(w, 500, "Create authorized application failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]any{"id": id, "appId": appID, "clientId": clientID, "name": name, "scopes": scopes, "webhooksEnabled": true})
}

func (h Handler) ClearAuthorizedApplications(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	_, _ = h.DB.Exec(r.Context(), `delete from authorized_application_grant where user_id=$1`, p.UserID)
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) CreateSlackIntegration(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	now := time.Now().UTC()
	var id string
	err := h.DB.QueryRow(r.Context(), `insert into workspace_integration (workspace_id,provider,status,display_name,external_id,metadata,connected_by_user_id,connected_at,updated_at) values ($1::uuid,'slack','connected','E2E Slack Workspace',$2,$3::jsonb,$4,$5,$5) on conflict (workspace_id,provider) do update set status='connected', display_name='E2E Slack Workspace', connected_by_user_id=excluded.connected_by_user_id, connected_at=excluded.connected_at, updated_at=excluded.updated_at returning id::text`, p.WorkspaceID, "T_"+p.WorkspaceID, []byte(`{"createdBy":"playwright"}`), p.UserID, now).Scan(&id)
	if err != nil {
		problem.Write(w, 500, "Create Slack integration failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"success": true, "id": id})
}

func (h Handler) DeleteSlackIntegration(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	_, _ = h.DB.Exec(r.Context(), `delete from workspace_integration where workspace_id=$1::uuid and provider='slack'`, p.WorkspaceID)
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func helperID(prefix string) string { return prefix + "_" + randomHex(8) }
func randomHex(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
