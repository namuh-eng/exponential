package integrations

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type CatalogItem struct {
	Provider    string `json:"provider"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type SetupRequirement struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type Actions struct {
	CanConnect    bool `json:"canConnect"`
	CanManage     bool `json:"canManage"`
	CanDisconnect bool `json:"canDisconnect"`
}

type Integration struct {
	CatalogItem
	ID               *string           `json:"id"`
	Status           string            `json:"status"`
	DisplayName      *string           `json:"displayName"`
	ExternalID       *string           `json:"externalId"`
	ConnectedAt      *string           `json:"connectedAt"`
	SetupRequirement *SetupRequirement `json:"setupRequirement"`
	Actions          Actions           `json:"actions"`
}

type response struct {
	CanManageIntegrations bool          `json:"canManageIntegrations"`
	Integrations          []Integration `json:"integrations"`
}

var catalog = []CatalogItem{
	{Provider: "github", Name: "GitHub", Description: "Sync pull requests, commits, and issue links with Linear."},
	{Provider: "slack", Name: "Slack", Description: "Send issue updates and create issues from Slack messages."},
	{Provider: "zendesk", Name: "Zendesk", Description: "Connect support tickets to product work and customer requests."},
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Delete("/", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.listRows(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List integrations failed", err.Error())
		return
	}
	byProvider := map[string]row{}
	for _, row := range rows {
		byProvider[row.Provider] = row
	}
	canManage := canManage(p.Role)
	out := []Integration{}
	for _, item := range catalog {
		connected, ok := byProvider[item.Provider]
		requirement := (*SetupRequirement)(nil)
		if !ok {
			requirement = setupRequirement(item.Provider)
		}
		status := "not_connected"
		var id, displayName, externalID, connectedAt *string
		if ok {
			status = connected.Status
			id = &connected.ID
			displayName = connected.DisplayName
			externalID = connected.ExternalID
			connectedAt = formatTime(connected.ConnectedAt)
		} else if requirement != nil {
			status = "configuration_required"
		}
		out = append(out, Integration{CatalogItem: item, ID: id, Status: status, DisplayName: displayName, ExternalID: externalID, ConnectedAt: connectedAt, SetupRequirement: requirement, Actions: Actions{CanConnect: canManage && !ok && requirement == nil, CanManage: canManage && ok, CanDisconnect: canManage && ok}})
	}
	problem.JSON(w, 200, response{CanManageIntegrations: canManage, Integrations: out})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	if provider == "" {
		problem.Write(w, 400, "Provider is required", "")
		return
	}
	_, err := h.DB.Exec(r.Context(), `delete from workspace_integration where workspace_id=$1::uuid and provider=$2`, p.WorkspaceID, provider)
	if err != nil {
		problem.Write(w, 500, "Delete integration failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

type row struct {
	ID          string
	Provider    string
	Status      string
	DisplayName *string
	ExternalID  *string
	ConnectedAt *time.Time
}

func (h Handler) listRows(ctx context.Context, workspaceID string) ([]row, error) {
	rows, err := h.DB.Query(ctx, `select id::text, provider, status, display_name, external_id, connected_at from workspace_integration where workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []row{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.ID, &r.Provider, &r.Status, &r.DisplayName, &r.ExternalID, &r.ConnectedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func canManage(role string) bool { return role == "owner" || role == "admin" }

func setupRequirement(provider string) *SetupRequirement {
	if provider == "slack" && !slackConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Slack OAuth credentials are not configured. Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable installation."}
	}
	if provider == "github" || provider == "zendesk" {
		name := "GitHub"
		if provider == "zendesk" {
			name = "Zendesk"
		}
		return &SetupRequirement{Type: "configuration_required", Message: name + " setup is not configured in this environment yet."}
	}
	return nil
}

func slackConfigured() bool {
	return strings.TrimSpace(os.Getenv("AUTH_SLACK_ID")) != "" && strings.TrimSpace(os.Getenv("AUTH_SLACK_SECRET")) != ""
}

func formatTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func isNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
