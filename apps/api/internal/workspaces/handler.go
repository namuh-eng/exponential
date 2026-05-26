package workspaces

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Membership struct {
	WorkspaceID   string `json:"workspaceId"`
	Role          string `json:"role"`
	WorkspaceName string `json:"workspaceName"`
	WorkspaceSlug string `json:"workspaceSlug"`
}

type Workspace struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	URLSlug        string  `json:"urlSlug"`
	Logo           *string `json:"logo"`
	Region         string  `json:"region"`
	FiscalMonth    string  `json:"fiscalMonth"`
	WelcomeMessage string  `json:"welcomeMessage"`
	Plan           string  `json:"plan"`
}

type CurrentWorkspaceResponse struct {
	Workspace Workspace `json:"workspace"`
}

type createWorkspaceRequest struct {
	Name    string `json:"name"`
	URLSlug string `json:"urlSlug"`
}

type createWorkspaceResponse struct {
	Workspace WorkspaceSummary `json:"workspace"`
	Team      TeamSummary      `json:"team"`
}

type WorkspaceSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URLSlug   string `json:"urlSlug"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type TeamSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Key         string `json:"key"`
	WorkspaceID string `json:"workspaceId"`
}

type patchWorkspaceRequest struct {
	Name           *string `json:"name"`
	URLSlug        *string `json:"urlSlug"`
	Logo           any     `json:"logo"`
	FiscalMonth    *string `json:"fiscalMonth"`
	WelcomeMessage *string `json:"welcomeMessage"`
}

type memberEntry struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	UserID        *string  `json:"userId"`
	Name          string   `json:"name"`
	Email         string   `json:"email"`
	Image         *string  `json:"image"`
	Role          string   `json:"role"`
	Status        string   `json:"status"`
	Teams         []string `json:"teams"`
	JoinedAt      string   `json:"joinedAt"`
	LastSeenAt    *string  `json:"lastSeenAt"`
	Pronouns      string   `json:"pronouns,omitempty"`
	Title         string   `json:"title,omitempty"`
	Location      string   `json:"location,omitempty"`
	Timezone      string   `json:"timezone,omitempty"`
	ShowLocalTime bool     `json:"showLocalTime,omitempty"`
}

type membersResponse struct {
	WorkspaceID      string        `json:"workspaceId"`
	CurrentUserID    string        `json:"currentUserId"`
	ViewerRole       string        `json:"viewerRole"`
	CanInviteMembers bool          `json:"canInviteMembers"`
	Members          []memberEntry `json:"members"`
}

type mutateMemberRequest struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Role   string `json:"role"`
	Action string `json:"action"`
}

type inviteRequest struct {
	WorkspaceID string `json:"workspaceId"`
	Invites     []struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	} `json:"invites"`
}

type inviteResult struct {
	Email  string `json:"email"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/current", h.GetCurrent)
	r.Patch("/current", h.UpdateCurrent)
	r.Get("/current/security", h.GetCurrentSecurity)
	r.Get("/current/api", h.GetCurrentAPI)
	r.Patch("/current/api", h.UpdateCurrentAPISettings)
	r.Post("/current/api", h.MutateCurrentAPI)
	r.Patch("/current/security", h.UpdateCurrentSecurity)
	r.Get("/current/billing", h.GetBilling)
	r.Patch("/current/billing", h.UpdateBilling)
	r.Delete("/current", h.DeleteCurrent)
	r.Get("/members", h.ListMembers)
	r.Patch("/members", h.UpdateMemberOrInvitation)
	r.Post("/members", h.ResendInvitation)
	r.Delete("/members", h.RemoveMemberOrInvitation)
	r.Post("/invite", h.Invite)
	r.Get("/current/import-export", h.GetCurrentImportExport)
	r.Post("/current/import-export", h.MutateCurrentImportExport)
	r.Get("/current/import-export/exports/{id}/download", h.DownloadCurrentExport)
	r.Get("/exports", h.ListLegacyExports)
	r.Post("/exports", h.CreateLegacyExport)
	r.Get("/imports", h.ListLegacyImports)
	r.Post("/imports", h.CreateLegacyImport)
	r.Post("/imports/preview", h.PreviewImport)
	r.Patch("/current/security/saml", h.UpdateSAML)
	r.Patch("/current/security/scim", h.UpdateSCIM)
	r.Post("/current/security/scim", h.CreateSCIMToken)
	r.Delete("/current/security/scim/tokens/{tokenId}", h.RevokeSCIMToken)
	r.Get("/current/applications", h.ListApplications)
	r.Delete("/current/applications/{id}", h.DeleteApplication)
	r.Get("/current/sla", h.GetSLA)
	r.Post("/current/sla", h.CreateSLA)
	r.Patch("/current/sla/{id}", h.UpdateSLA)
	r.Delete("/current/sla/{id}", h.DeleteSLA)
	r.Get("/current/ai-settings", h.GetAISettings)
	r.Patch("/current/ai-settings", h.UpdateAISettings)
	r.Get("/current/initiatives-settings", h.GetInitiativeSettings)
	r.Patch("/current/initiatives-settings", h.UpdateInitiativeSettings)
	r.Get("/current/collaboration", h.GetCollaboration)
	r.Patch("/current/collaboration", h.UpdateCollaboration)
	r.Get("/current/documents", h.GetDocumentsSettings)
	r.Patch("/current/documents", h.UpdateDocumentsSettings)
	r.Post("/current/documents", h.CreateDocumentTemplate)
	return r
}

type importPreviewRequest struct {
	CSV     string         `json:"csv"`
	TeamID  string         `json:"teamId"`
	Mapping map[string]any `json:"mapping"`
}

type importPreviewRow struct {
	Row         int      `json:"row"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Priority    string   `json:"priority"`
	Status      string   `json:"status"`
	Errors      []string `json:"errors"`
}

func (h Handler) PreviewImport(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Workspace admin access required", "")
		return
	}
	var input importPreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	mapping := input.Mapping
	if mapping == nil {
		mapping = map[string]any{}
	}
	titleColumn := stringFromMap(mapping, "title")
	if titleColumn == "" {
		problem.Write(w, 400, "Map a title column before previewing.", "")
		return
	}
	teamID := strings.TrimSpace(input.TeamID)
	if teamID == "" || !h.teamInWorkspace(r.Context(), teamID, p.WorkspaceID) {
		problem.Write(w, 400, "Choose a valid target team.", "")
		return
	}
	stateNames, err := h.workflowStateNames(r.Context(), teamID)
	if err != nil {
		problem.Write(w, 500, "Preview import failed", err.Error())
		return
	}
	rows := parseImportCSV(input.CSV)
	if len(rows) == 0 {
		problem.Write(w, 400, "CSV must include at least one issue row.", "")
		return
	}
	limit := len(rows)
	if limit > 100 {
		limit = 100
	}
	preview := make([]importPreviewRow, 0, limit)
	for _, row := range rows[:limit] {
		title := row.get(titleColumn)
		status := row.get(stringFromMap(mapping, "status"))
		errors := []string{}
		if strings.TrimSpace(title) == "" {
			errors = append(errors, "Title is required")
		}
		if status != "" && !stateNames[strings.ToLower(status)] {
			errors = append(errors, "Unknown status: "+status)
		}
		preview = append(preview, importPreviewRow{Row: row.row, Title: title, Description: row.get(stringFromMap(mapping, "description")), Priority: row.get(stringFromMap(mapping, "priority")), Status: status, Errors: errors})
	}
	problem.JSON(w, 200, map[string]any{"preview": preview})
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(), `
		select m.workspace_id::text, m.role::text, w.name, w.url_slug
		from member m join workspace w on w.id = m.workspace_id
		where m.user_id = $1
		order by m.created_at desc`, p.UserID)
	if err != nil {
		problem.Write(w, 500, "List workspaces failed", err.Error())
		return
	}
	defer rows.Close()
	memberships := []Membership{}
	for rows.Next() {
		var item Membership
		if err := rows.Scan(&item.WorkspaceID, &item.Role, &item.WorkspaceName, &item.WorkspaceSlug); err != nil {
			problem.Write(w, 500, "List workspaces failed", err.Error())
			return
		}
		memberships = append(memberships, item)
	}
	problem.JSON(w, 200, memberships)
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input createWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if err := validateWorkspaceName(name); err != nil {
		problem.Write(w, 400, "Invalid workspace", err.Error())
		return
	}
	slug := sanitizeSlug(input.URLSlug)
	if err := validateSlug(slug); err != nil {
		problem.Write(w, 400, "Invalid workspace", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var ws WorkspaceSummary
	err = tx.QueryRow(r.Context(), `
		insert into workspace (name, url_slug, settings)
		values ($1, $2, '{"region":"United States","fiscalMonth":"january"}'::jsonb)
		returning id::text, name, url_slug, created_at, updated_at`, name, slug).Scan(&ws.ID, &ws.Name, &ws.URLSlug, tsScanner(&ws.CreatedAt), tsScanner(&ws.UpdatedAt))
	if isUniqueViolation(err) {
		problem.Write(w, 409, "Workspace URL already taken", "This URL is already taken")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `insert into member (user_id, workspace_id, role) values ($1, $2::uuid, 'owner')`, p.UserID, ws.ID); err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	teamKey, err := h.nextTeamKey(r.Context(), tx, name)
	if err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	var team TeamSummary
	if err := tx.QueryRow(r.Context(), `insert into team (name, key, workspace_id) values ($1,$2,$3::uuid) returning id::text, name, key, workspace_id::text`, name, teamKey, ws.ID).Scan(&team.ID, &team.Name, &team.Key, &team.WorkspaceID); err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `insert into team_member (team_id, user_id) values ($1::uuid, $2)`, team.ID, p.UserID); err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	if err := insertDefaultWorkflowStates(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create workspace failed", err.Error())
		return
	}
	setActiveWorkspaceCookies(w, r, ws.ID, ws.URLSlug)
	problem.JSON(w, 201, createWorkspaceResponse{Workspace: ws, Team: team})
}

func setActiveWorkspaceCookies(w http.ResponseWriter, r *http.Request, workspaceID string, workspaceSlug string) {
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	for _, cookie := range []*http.Cookie{
		{Name: "activeWorkspaceId", Value: workspaceID, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
		{Name: "activeWorkspaceSlug", Value: workspaceSlug, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
	} {
		http.SetCookie(w, cookie)
	}
}

type billingPlan struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Price       string   `json:"price"`
	Description string   `json:"description"`
	Features    []string `json:"features"`
}

type billingPatchRequest struct {
	Plan any `json:"plan"`
}

type billingWorkspace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URLSlug string `json:"urlSlug"`
	Role    string `json:"role"`
}

type billingUsage struct {
	SeatsUsed  int `json:"seatsUsed"`
	IssuesUsed int `json:"issuesUsed"`
	IssueLimit int `json:"issueLimit"`
}

type billingResponse struct {
	Workspace      billingWorkspace `json:"workspace"`
	CurrentPlan    string           `json:"currentPlan"`
	CanManage      bool             `json:"canManage"`
	Usage          billingUsage     `json:"usage"`
	Plans          []billingPlan    `json:"plans"`
	PaymentMethods []any            `json:"paymentMethods"`
	Invoices       []any            `json:"invoices"`
}

type workspaceDocumentTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type workspaceDocumentsSettings struct {
	DefaultVisibility        string                      `json:"defaultVisibility"`
	AutoLinkProjectDocuments bool                        `json:"autoLinkProjectDocuments"`
	Templates                []workspaceDocumentTemplate `json:"templates"`
}

type workspaceDocumentsResponse struct {
	Documents workspaceDocumentsSettings `json:"documents"`
	Template  *workspaceDocumentTemplate `json:"template,omitempty"`
}

type workspaceDocumentsPatch struct {
	DefaultVisibility        any `json:"defaultVisibility"`
	AutoLinkProjectDocuments any `json:"autoLinkProjectDocuments"`
}

type workspaceDocumentTemplateRequest struct {
	Name        any `json:"name"`
	Description any `json:"description"`
}

type collaborationSettings struct {
	Asks             asksSettings            `json:"asks"`
	Pulse            pulseSettings           `json:"pulse"`
	CustomerRequests customerRequestSettings `json:"customerRequests"`
}

type asksSettings struct {
	Enabled         bool   `json:"enabled"`
	IntakeEmail     string `json:"intakeEmail"`
	DefaultPriority string `json:"defaultPriority"`
	AutoAssign      bool   `json:"autoAssign"`
}

type pulseSettings struct {
	Enabled         bool   `json:"enabled"`
	DigestFrequency string `json:"digestFrequency"`
	BurnoutAlerts   bool   `json:"burnoutAlerts"`
	VelocityTarget  int    `json:"velocityTarget"`
}

type customerRequestSettings struct {
	Enabled             bool   `json:"enabled"`
	IntakeEmail         string `json:"intakeEmail"`
	DefaultPriority     string `json:"defaultPriority"`
	AutoLinkIssues      bool   `json:"autoLinkIssues"`
	RequireCompany      bool   `json:"requireCompany"`
	ConfirmationMessage string `json:"confirmationMessage"`
}

type collaborationPermissions struct {
	CanManage bool   `json:"canManage"`
	Role      string `json:"role"`
}

type collaborationResponse struct {
	Collaboration collaborationSettings    `json:"collaboration"`
	Permissions   collaborationPermissions `json:"permissions"`
}

type workspaceInitiativeSettings struct {
	Enabled        bool   `json:"enabled"`
	ProjectRollups bool   `json:"projectRollups"`
	Visibility     string `json:"visibility"`
	RoadmapMode    string `json:"roadmapMode"`
}

type initiativeSettingsResponse struct {
	InitiativesSettings workspaceInitiativeSettings `json:"initiativesSettings"`
	ViewerRole          string                      `json:"viewerRole"`
	CanManage           bool                        `json:"canManage"`
}

const workspaceAgentGuidanceMaxLength = 4000

type workspaceAISettings struct {
	AIFeaturesEnabled       bool   `json:"aiFeaturesEnabled"`
	AskLinearEnabled        bool   `json:"askLinearEnabled"`
	IssueSuggestionsEnabled bool   `json:"issueSuggestionsEnabled"`
	SummariesEnabled        bool   `json:"summariesEnabled"`
	AutoTriageEnabled       bool   `json:"autoTriageEnabled"`
	WorkspaceAgentGuidance  string `json:"workspaceAgentGuidance"`
	AgentUsagePermission    string `json:"agentUsagePermission"`
}

type aiCapabilities struct {
	CanManageAiSettings bool `json:"canManageAiSettings"`
	CanUseAgents        bool `json:"canUseAgents"`
}

type aiLimits struct {
	WorkspaceAgentGuidanceMaxLength int `json:"workspaceAgentGuidanceMaxLength"`
}

type aiSettingsResponse struct {
	AISettings   workspaceAISettings `json:"aiSettings"`
	Capabilities aiCapabilities      `json:"capabilities"`
	Limits       aiLimits            `json:"limits"`
}

type slaPolicyCondition struct {
	Priority *string `json:"priority,omitempty"`
	TeamKey  *string `json:"teamKey,omitempty"`
}

type slaPolicy struct {
	ID                  string             `json:"id"`
	Name                string             `json:"name"`
	Description         *string            `json:"description"`
	ResponseTimeHours   float64            `json:"responseTimeHours"`
	ResolutionTimeHours float64            `json:"resolutionTimeHours"`
	Enabled             bool               `json:"enabled"`
	Conditions          slaPolicyCondition `json:"conditions"`
	CreatedAt           string             `json:"createdAt"`
	UpdatedAt           string             `json:"updatedAt"`
}

type slaSettings struct {
	Policies []slaPolicy `json:"policies"`
}

type slaResponse struct {
	SLA struct {
		Policies  []slaPolicy `json:"policies"`
		CanManage bool        `json:"canManage"`
	} `json:"sla"`
}

type slaPolicyResponse struct {
	Policy slaPolicy `json:"policy"`
}

type workspaceApplicationsResponse struct {
	Applications          []workspaceApplication `json:"applications"`
	CanManageApplications bool                   `json:"canManageApplications"`
}

type workspaceApplication struct {
	ID               string            `json:"id"`
	AppID            string            `json:"appId"`
	ClientID         string            `json:"clientId"`
	Name             string            `json:"name"`
	ImageURL         *string           `json:"imageUrl"`
	Scopes           []string          `json:"scopes"`
	PermissionGroups []permissionGroup `json:"permissionGroups"`
	WebhooksEnabled  bool              `json:"webhooksEnabled"`
	CreatedAt        *string           `json:"createdAt"`
	UpdatedAt        *string           `json:"updatedAt"`
	LastUsedAt       *string           `json:"lastUsedAt"`
	Owner            applicationOwner  `json:"owner"`
}

type applicationOwner struct {
	Name  string  `json:"name"`
	Email string  `json:"email"`
	Image *string `json:"image"`
}

type permissionGroup struct {
	Label        string   `json:"label"`
	Descriptions []string `json:"descriptions"`
}

type samlSettings struct {
	Enabled      bool     `json:"enabled"`
	Domains      []string `json:"domains"`
	IDPSSOURL    string   `json:"idpSsoUrl"`
	EntityID     string   `json:"entityId"`
	Certificate  string   `json:"certificate"`
	MetadataURL  string   `json:"metadataUrl"`
	LastTestedAt *string  `json:"lastTestedAt"`
	Status       string   `json:"status"`
	LastError    *string  `json:"lastError"`
}

type scimToken struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	TokenHash  string  `json:"tokenHash,omitempty"`
	CreatedAt  string  `json:"createdAt"`
	RevokedAt  *string `json:"revokedAt"`
	LastUsedAt *string `json:"lastUsedAt"`
}

type publicScimToken struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	CreatedAt  string  `json:"createdAt"`
	RevokedAt  *string `json:"revokedAt"`
	LastUsedAt *string `json:"lastUsedAt"`
}

type scimSettings struct {
	Enabled    bool        `json:"enabled"`
	BaseURL    string      `json:"baseUrl"`
	Tokens     []scimToken `json:"tokens"`
	LastSyncAt *string     `json:"lastSyncAt"`
	Status     string      `json:"status"`
}

type publicScimSettings struct {
	Enabled    bool              `json:"enabled"`
	BaseURL    string            `json:"baseUrl"`
	Tokens     []publicScimToken `json:"tokens"`
	LastSyncAt *string           `json:"lastSyncAt"`
	Status     string            `json:"status"`
}

func (h Handler) UpdateSAML(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage SAML settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update SAML settings failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON body", err.Error())
		return
	}
	saml := normalizeSAMLInput(body, readSAMLSettings(settings))
	if validation := validateSAMLSettings(saml); validation != "" {
		problem.Write(w, 400, validation, "")
		return
	}
	security := recordFromAny(settings["security"])
	security["saml"] = saml
	settings["security"] = security
	if err := h.saveWorkspaceSettings(r.Context(), p.WorkspaceID, settings); err != nil {
		problem.Write(w, 500, "Update SAML settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"saml": saml})
}

func (h Handler) UpdateSCIM(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage SCIM settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update SCIM settings failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	enabled, ok := body["enabled"].(bool)
	if !ok {
		problem.Write(w, 400, "SCIM enabled must be a boolean", "")
		return
	}
	scim := readSCIMSettings(settings, scimBaseURL(r, p.WorkspaceID))
	scim.Enabled = enabled
	if enabled {
		scim.Status = "enabled"
	} else {
		scim.Status = "disabled"
	}
	if err := h.storeSCIMSettings(r.Context(), p.WorkspaceID, settings, scim); err != nil {
		problem.Write(w, 500, "Update SCIM settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"scim": publicSCIM(scim)})
}

func (h Handler) CreateSCIMToken(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage SCIM settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create SCIM token failed", err.Error())
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	secret, token := createSCIMToken(asStringValue(body["name"]))
	scim := readSCIMSettings(settings, scimBaseURL(r, p.WorkspaceID))
	scim.Enabled = true
	scim.Status = "enabled"
	scim.Tokens = append(scim.Tokens, token)
	if err := h.storeSCIMSettings(r.Context(), p.WorkspaceID, settings, scim); err != nil {
		problem.Write(w, 500, "Create SCIM token failed", err.Error())
		return
	}
	created := publicToken(token)
	problem.JSON(w, 200, map[string]any{"token": secret, "scim": publicSCIM(scim), "created": created})
}

func (h Handler) RevokeSCIMToken(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage SCIM settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Revoke SCIM token failed", err.Error())
		return
	}
	tokenID := chi.URLParam(r, "tokenId")
	scim := readSCIMSettings(settings, scimBaseURL(r, p.WorkspaceID))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for idx := range scim.Tokens {
		if scim.Tokens[idx].ID == tokenID && scim.Tokens[idx].RevokedAt == nil {
			scim.Tokens[idx].RevokedAt = &now
		}
	}
	if err := h.storeSCIMSettings(r.Context(), p.WorkspaceID, settings, scim); err != nil {
		problem.Write(w, 500, "Revoke SCIM token failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"scim": publicSCIM(scim)})
}

func (h Handler) ListApplications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select g.id, g.app_id, g.client_id, g.name, g.image_url, g.scopes, g.webhooks_enabled, g.created_at, g.updated_at, u.name, u.email, u.image
		from authorized_application_grant g
		join member m on m.user_id=g.user_id and m.workspace_id=g.workspace_id
		join "user" u on u.id=g.user_id
		where g.workspace_id=$1::uuid
		order by g.updated_at desc`, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List applications failed", err.Error())
		return
	}
	defer rows.Close()
	applications := []workspaceApplication{}
	for rows.Next() {
		var app workspaceApplication
		var scopesRaw []byte
		var createdAt, updatedAt *time.Time
		if err := rows.Scan(&app.ID, &app.AppID, &app.ClientID, &app.Name, &app.ImageURL, &scopesRaw, &app.WebhooksEnabled, &createdAt, &updatedAt, &app.Owner.Name, &app.Owner.Email, &app.Owner.Image); err != nil {
			problem.Write(w, 500, "List applications failed", err.Error())
			return
		}
		app.Scopes = normalizeApplicationScopes(scopesRaw)
		app.PermissionGroups = buildApplicationPermissionGroups(app.Scopes)
		app.CreatedAt = formatOptionalTime(createdAt)
		app.UpdatedAt = formatOptionalTime(updatedAt)
		applications = append(applications, app)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "List applications failed", err.Error())
		return
	}
	problem.JSON(w, 200, workspaceApplicationsResponse{Applications: applications, CanManageApplications: true})
}

func (h Handler) DeleteApplication(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		problem.Write(w, 400, "Application id is required.", "")
		return
	}
	var found string
	err := h.DB.QueryRow(r.Context(), `
		select g.id from authorized_application_grant g
		join member m on m.user_id=g.user_id and m.workspace_id=g.workspace_id
		where g.workspace_id=$1::uuid and g.id=$2 limit 1`, p.WorkspaceID, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Application not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete application failed", err.Error())
		return
	}
	if _, err := h.DB.Exec(r.Context(), `delete from authorized_application_grant where id=$1`, id); err != nil {
		problem.Write(w, 500, "Delete application failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) GetSLA(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get SLA policies failed", err.Error())
		return
	}
	out := slaResponse{}
	out.SLA.Policies = readSLASettings(settings).Policies
	out.SLA.CanManage = isManager(p.Role)
	problem.JSON(w, 200, out)
}

func (h Handler) CreateSLA(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create SLA policy failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	value, err := normalizeSLAPolicyInput(body)
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	policy := value
	policy.ID = createRandomID("sla")
	policy.CreatedAt = now
	policy.UpdatedAt = now
	current := readSLASettings(settings)
	current.Policies = append([]slaPolicy{policy}, current.Policies...)
	if err := h.saveSLASettings(r.Context(), p.WorkspaceID, settings, current); err != nil {
		problem.Write(w, 500, "Create SLA policy failed", err.Error())
		return
	}
	problem.JSON(w, 201, slaPolicyResponse{Policy: policy})
}

func (h Handler) UpdateSLA(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update SLA policy failed", err.Error())
		return
	}
	id := chi.URLParam(r, "id")
	current := readSLASettings(settings)
	idx := -1
	for i, policy := range current.Policies {
		if policy.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		problem.Write(w, 404, "SLA policy not found", "")
		return
	}
	body := policyToMap(current.Policies[idx])
	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	for key, value := range patch {
		body[key] = value
	}
	updated, err := normalizeSLAPolicyInput(body)
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	updated.ID = current.Policies[idx].ID
	updated.CreatedAt = current.Policies[idx].CreatedAt
	updated.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	current.Policies[idx] = updated
	if err := h.saveSLASettings(r.Context(), p.WorkspaceID, settings, current); err != nil {
		problem.Write(w, 500, "Update SLA policy failed", err.Error())
		return
	}
	problem.JSON(w, 200, slaPolicyResponse{Policy: updated})
}

func (h Handler) DeleteSLA(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete SLA policy failed", err.Error())
		return
	}
	id := chi.URLParam(r, "id")
	current := readSLASettings(settings)
	next := []slaPolicy{}
	found := false
	for _, policy := range current.Policies {
		if policy.ID == id {
			found = true
			continue
		}
		next = append(next, policy)
	}
	if !found {
		problem.Write(w, 404, "SLA policy not found", "")
		return
	}
	current.Policies = next
	if err := h.saveSLASettings(r.Context(), p.WorkspaceID, settings, current); err != nil {
		problem.Write(w, 500, "Delete SLA policy failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"ok": true})
}

func (h Handler) GetAISettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get AI settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildAISettingsResponse(settings, p.Role))
}

func (h Handler) UpdateAISettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage workspace AI settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update AI settings failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	patch, ok := body["aiSettings"].(map[string]any)
	if !ok || patch == nil {
		problem.Write(w, 400, "aiSettings is required", "")
		return
	}
	if value, exists := patch["workspaceAgentGuidance"]; exists {
		text, ok := value.(string)
		if !ok {
			problem.Write(w, 400, "Workspace agent guidance must be text", "")
			return
		}
		if len(text) > workspaceAgentGuidanceMaxLength {
			problem.Write(w, 400, fmt.Sprintf("Workspace agent guidance must be %d characters or fewer", workspaceAgentGuidanceMaxLength), "")
			return
		}
	}
	next := patchAISettings(readWorkspaceAISettings(settings), patch)
	settings["ai"] = serializeWorkspaceAISettings(next)
	raw, _ := json.Marshal(settings)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Update AI settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildAISettingsResponse(settings, p.Role))
}

func (h Handler) GetInitiativeSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get initiative settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, initiativeSettingsResponse{InitiativesSettings: readInitiativeSettings(settings), ViewerRole: p.Role, CanManage: isManager(p.Role)})
}

func (h Handler) UpdateInitiativeSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage initiative settings", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update initiative settings failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	next, err := patchInitiativeSettings(readInitiativeSettings(settings), body)
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	features := recordFromAny(settings["features"])
	features["initiatives"] = next
	settings["features"] = features
	raw, _ := json.Marshal(settings)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Update initiative settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, initiativeSettingsResponse{InitiativesSettings: next, ViewerRole: p.Role, CanManage: true})
}

func (h Handler) GetCollaboration(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get collaboration settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, collaborationResponse{Collaboration: readCollaborationSettings(settings), Permissions: collaborationPermissions{CanManage: isManager(p.Role), Role: p.Role}})
}

func (h Handler) UpdateCollaboration(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update collaboration settings failed", err.Error())
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	collaboration := mergeCollaborationSettings(settings, body)
	settings["collaboration"] = collaboration
	raw, _ := json.Marshal(settings)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Update collaboration settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, collaborationResponse{Collaboration: readCollaborationSettings(settings), Permissions: collaborationPermissions{CanManage: true, Role: p.Role}})
}

func (h Handler) GetDocumentsSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get document settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, workspaceDocumentsResponse{Documents: normalizeWorkspaceDocuments(settings)})
}

func (h Handler) UpdateDocumentsSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update document settings failed", err.Error())
		return
	}
	var input workspaceDocumentsPatch
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	documents := normalizeWorkspaceDocuments(settings)
	if v, ok := input.DefaultVisibility.(string); ok && (v == "workspace" || v == "private") {
		documents.DefaultVisibility = v
	}
	if v, ok := input.AutoLinkProjectDocuments.(bool); ok {
		documents.AutoLinkProjectDocuments = v
	}
	if err := h.saveWorkspaceDocuments(r.Context(), p.WorkspaceID, settings, documents); err != nil {
		problem.Write(w, 500, "Update document settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, workspaceDocumentsResponse{Documents: documents})
}

func (h Handler) CreateDocumentTemplate(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create document template failed", err.Error())
		return
	}
	var input workspaceDocumentTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := truncate(strings.TrimSpace(asStringValue(input.Name)), 120)
	if name == "" {
		problem.Write(w, 400, "Template name is required", "")
		return
	}
	documents := normalizeWorkspaceDocuments(settings)
	template := workspaceDocumentTemplate{ID: createRandomID("doc_tpl"), Name: name, Description: truncate(strings.TrimSpace(asStringValue(input.Description)), 500)}
	documents.Templates = append([]workspaceDocumentTemplate{template}, documents.Templates...)
	if err := h.saveWorkspaceDocuments(r.Context(), p.WorkspaceID, settings, documents); err != nil {
		problem.Write(w, 500, "Create document template failed", err.Error())
		return
	}
	problem.JSON(w, 201, workspaceDocumentsResponse{Documents: documents, Template: &template})
}

func (h Handler) GetBilling(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	response, err := h.billingResponse(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get billing failed", err.Error())
		return
	}
	problem.JSON(w, 200, response)
}

func (h Handler) UpdateBilling(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Only workspace admins can manage billing", "")
		return
	}
	var input billingPatchRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	requestedPlan := normalizeBillingPlan(input.Plan)
	if requestedPlan != input.Plan {
		problem.Write(w, 400, "Unsupported billing plan", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update billing failed", err.Error())
		return
	}
	billing := recordFromAny(settings["billing"])
	settings["plan"] = requestedPlan
	billing["plan"] = requestedPlan
	settings["billing"] = billing
	body, _ := json.Marshal(settings)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Update billing failed", err.Error())
		return
	}
	response, err := h.billingResponse(r.Context(), p)
	if err != nil {
		problem.Write(w, 500, "Update billing failed", err.Error())
		return
	}
	problem.JSON(w, 200, response)
}

func (h Handler) GetCurrent(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	ws, _, err := h.currentWorkspace(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get current workspace failed", err.Error())
		return
	}
	problem.JSON(w, 200, CurrentWorkspaceResponse{Workspace: ws})
}

func (h Handler) UpdateCurrent(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	current, role, err := h.currentWorkspace(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update workspace failed", err.Error())
		return
	}
	if !isManager(role) {
		problem.Write(w, 403, "Only workspace admins can update a workspace", "")
		return
	}
	var input patchWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if err := validateWorkspaceName(name); err != nil {
		problem.Write(w, 400, "Invalid workspace", err.Error())
		return
	}
	slug := current.URLSlug
	if input.URLSlug != nil {
		slug = *input.URLSlug
	}
	if err := validateSlug(slug); err != nil {
		problem.Write(w, 400, "Invalid workspace", err.Error())
		return
	}
	logo := current.Logo
	if input.Logo != nil {
		s, ok := input.Logo.(string)
		if !ok || (s != "" && !isSupportedLogo(strings.TrimSpace(s))) {
			problem.Write(w, 400, "Unsupported logo image", "")
			return
		}
		trimmed := strings.TrimSpace(s)
		if len(trimmed) > 2_000_000 && strings.HasPrefix(trimmed, "data:image/") {
			problem.Write(w, 400, "Logo image is too large", "")
			return
		}
		if trimmed == "" {
			logo = nil
		} else {
			logo = &trimmed
		}
	}
	fiscalMonth := current.FiscalMonth
	if input.FiscalMonth != nil && supportedFiscalMonth(*input.FiscalMonth) {
		fiscalMonth = *input.FiscalMonth
	}
	welcome := current.WelcomeMessage
	if input.WelcomeMessage != nil {
		welcome = truncate(strings.TrimSpace(*input.WelcomeMessage), 2000)
	}
	settings := map[string]any{"region": current.Region, "fiscalMonth": fiscalMonth, "welcomeMessage": welcome, "plan": current.Plan}
	settingsJSON, _ := json.Marshal(settings)
	_, err = h.DB.Exec(r.Context(), `update workspace set name=$1, url_slug=$2, logo_url=$3, settings=$4::jsonb, updated_at=now() where id=$5::uuid`, name, slug, logo, settingsJSON, current.ID)
	if isUniqueViolation(err) {
		problem.Write(w, 409, "Workspace URL already taken", "This URL is already taken")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update workspace failed", err.Error())
		return
	}
	current.Name, current.URLSlug, current.Logo, current.FiscalMonth, current.WelcomeMessage = name, slug, logo, fiscalMonth, welcome
	problem.JSON(w, 200, CurrentWorkspaceResponse{Workspace: current})
}

func (h Handler) DeleteCurrent(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	_, role, err := h.currentWorkspace(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete workspace failed", err.Error())
		return
	}
	if !isManager(role) {
		problem.Write(w, 403, "Only workspace admins can delete a workspace", "")
		return
	}
	if _, err := h.DB.Exec(r.Context(), `delete from workspace where id=$1::uuid`, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Delete workspace failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"success": true, "redirectTo": "/"})
}

func (h Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if ok, err := h.ensureMembership(r.Context(), p.UserID, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "List members failed", err.Error())
		return
	} else if !ok {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	members, err := h.activeMembers(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List members failed", err.Error())
		return
	}
	invites, err := h.pendingInvitations(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List members failed", err.Error())
		return
	}
	members = append(members, invites...)
	problem.JSON(w, 200, membersResponse{WorkspaceID: p.WorkspaceID, CurrentUserID: p.UserID, ViewerRole: p.Role, CanInviteMembers: canInvite(p.Role), Members: members})
}

func (h Handler) UpdateMemberOrInvitation(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage members", "")
		return
	}
	var input mutateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	if input.ID == "" || (input.Kind != "member" && input.Kind != "invitation") || (input.Action != "" && (input.Kind != "invitation" || input.Action != "resend")) || (input.Action == "" && !validRole(input.Role)) {
		problem.Write(w, 400, "Invalid request", "")
		return
	}
	if input.Kind == "invitation" {
		h.updateInvitationRole(w, r, p, input)
		return
	}
	h.updateMemberRole(w, r, p, input)
}

func (h Handler) ResendInvitation(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage members", "")
		return
	}
	var input mutateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Kind != "invitation" || input.ID == "" || input.Action != "resend" {
		problem.Write(w, 400, "Invalid request", "")
		return
	}
	if err := h.rotateInvitationToken(r.Context(), p.WorkspaceID, input.ID); errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Pending invitation not found", "")
		return
	} else if err != nil {
		problem.Write(w, 500, "Resend invitation failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) RemoveMemberOrInvitation(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage members", "")
		return
	}
	var input mutateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.ID == "" || (input.Kind != "member" && input.Kind != "invitation") {
		problem.Write(w, 400, "Invalid request", "")
		return
	}
	if input.Kind == "invitation" {
		cmd, err := h.DB.Exec(r.Context(), `update workspace_invitation set status='revoked', updated_at=now() where id=$1::uuid and workspace_id=$2::uuid and status='pending'`, input.ID, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Revoke invitation failed", err.Error())
			return
		}
		if cmd.RowsAffected() == 0 {
			problem.Write(w, 404, "Pending invitation not found", "")
			return
		}
		problem.JSON(w, 200, map[string]bool{"success": true})
		return
	}
	h.removeMember(w, r, p, input.ID)
}

func (h Handler) Invite(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input inviteRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		workspaceID = p.WorkspaceID
	}
	if workspaceID == "" || len(input.Invites) == 0 {
		problem.Write(w, 400, "Invalid request", "Workspace ID and at least one invite are required")
		return
	}
	role, err := h.workspaceRole(r.Context(), p.UserID, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 403, "You are not a member of this workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Invite members failed", err.Error())
		return
	}
	if !canInvite(role) {
		problem.Write(w, 403, "You do not have permission to invite members", "")
		return
	}
	results := make([]inviteResult, 0, len(input.Invites))
	for _, invite := range input.Invites {
		email := strings.ToLower(strings.TrimSpace(invite.Email))
		role := invite.Role
		if role == "" {
			role = "member"
		}
		if email == "" || !strings.Contains(email, "@") {
			results = append(results, inviteResult{Email: invite.Email, Status: "failed", Error: "Invalid email"})
			continue
		}
		if !validInviteRole(role) {
			results = append(results, inviteResult{Email: email, Status: "failed", Error: "Invalid role"})
			continue
		}
		already, err := h.emailIsMember(r.Context(), workspaceID, email)
		if err != nil {
			results = append(results, inviteResult{Email: email, Status: "failed", Error: err.Error()})
			continue
		}
		if already {
			results = append(results, inviteResult{Email: email, Status: "failed", Error: "This person is already a workspace member"})
			continue
		}
		token := createInviteToken(workspaceID, email, role)
		_, err = h.DB.Exec(r.Context(), `
			insert into workspace_invitation (workspace_id, email, role, invited_by_user_id, token, status, accepted_at, updated_at)
			values ($1::uuid,$2,$3,$4,$5,'pending',null,now())
			on conflict (workspace_id, email) do update set role=excluded.role, invited_by_user_id=excluded.invited_by_user_id, token=excluded.token, status='pending', accepted_at=null, updated_at=now()`, workspaceID, email, role, p.UserID, token)
		if err != nil {
			results = append(results, inviteResult{Email: email, Status: "failed", Error: err.Error()})
			continue
		}
		results = append(results, inviteResult{Email: email, Status: "sent"})
	}
	problem.JSON(w, 200, map[string]any{"results": results})
}

func (h Handler) currentWorkspace(ctx context.Context, p auth.Principal) (Workspace, string, error) {
	var settings []byte
	var ws Workspace
	var role string
	err := h.DB.QueryRow(ctx, `
		select w.id::text, w.name, w.url_slug, w.logo_url, coalesce(w.settings, '{}'::jsonb), m.role::text
		from workspace w join member m on m.workspace_id = w.id and m.user_id = $1
		where w.id = $2::uuid
		limit 1`, p.UserID, p.WorkspaceID).Scan(&ws.ID, &ws.Name, &ws.URLSlug, &ws.Logo, &settings, &role)
	if err != nil {
		return Workspace{}, "", err
	}
	applyWorkspaceSettings(&ws, settings)
	return ws, role, nil
}

func (h Handler) workspaceRole(ctx context.Context, userID string, workspaceID string) (string, error) {
	var role string
	err := h.DB.QueryRow(ctx, `select role::text from member where user_id=$1 and workspace_id=$2::uuid`, userID, workspaceID).Scan(&role)
	return role, err
}

func (h Handler) ensureMembership(ctx context.Context, userID, workspaceID string) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from member where user_id=$1 and workspace_id=$2::uuid`, userID, workspaceID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (h Handler) activeMembers(ctx context.Context, workspaceID string) ([]memberEntry, error) {
	rows, err := h.DB.Query(ctx, `
		select m.id::text, u.id, coalesce(u.name,''), coalesce(u.email,''), u.image, m.role::text, m.created_at,
		       coalesce(array_remove(array_agg(distinct t.name), null), '{}') as teams,
		       max(s.updated_at) as last_seen_at,
		       coalesce(u.settings, '{}'::jsonb)
		from member m
		join "user" u on u.id = m.user_id
		left join team_member tm on tm.user_id = u.id
		left join team t on t.id = tm.team_id and t.workspace_id = m.workspace_id
		left join session s on s.user_id = u.id
		where m.workspace_id=$1::uuid
		group by m.id, u.id, u.name, u.email, u.image, m.role, m.created_at, u.settings
		order by u.name asc, u.email asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []memberEntry{}
	for rows.Next() {
		var entry memberEntry
		var userID string
		var joined time.Time
		var teams []string
		var lastSeen pgtype.Timestamptz
		var settings []byte
		if err := rows.Scan(&entry.ID, &userID, &entry.Name, &entry.Email, &entry.Image, &entry.Role, &joined, &teams, &lastSeen, &settings); err != nil {
			return nil, err
		}
		entry.Kind = "member"
		entry.UserID = &userID
		entry.Status = "active"
		entry.Teams = teams
		entry.JoinedAt = joined.UTC().Format(time.RFC3339Nano)
		if lastSeen.Valid {
			v := lastSeen.Time.UTC().Format(time.RFC3339Nano)
			entry.LastSeenAt = &v
		}
		applyProfileSettings(&entry, settings)
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (h Handler) pendingInvitations(ctx context.Context, workspaceID string) ([]memberEntry, error) {
	rows, err := h.DB.Query(ctx, `select id::text, email, role::text, created_at from workspace_invitation where workspace_id=$1::uuid and status='pending' order by created_at desc, email asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []memberEntry{}
	for rows.Next() {
		var entry memberEntry
		var created time.Time
		if err := rows.Scan(&entry.ID, &entry.Email, &entry.Role, &created); err != nil {
			return nil, err
		}
		entry.Kind = "invitation"
		entry.Name = "Pending invite"
		entry.Status = "pending"
		entry.Teams = []string{}
		entry.JoinedAt = created.UTC().Format(time.RFC3339Nano)
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (h Handler) updateMemberRole(w http.ResponseWriter, r *http.Request, p auth.Principal, input mutateMemberRequest) {
	var userID, role string
	err := h.DB.QueryRow(r.Context(), `select user_id, role::text from member where id=$1::uuid and workspace_id=$2::uuid`, input.ID, p.WorkspaceID).Scan(&userID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Member not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update member failed", err.Error())
		return
	}
	if userID == p.UserID {
		problem.Write(w, 400, "Use your account settings to change your own access", "")
		return
	}
	if p.Role != "owner" && (role == "owner" || input.Role == "owner") {
		problem.Write(w, 403, "Only owners can manage owner roles", "")
		return
	}
	if role == "owner" && input.Role != "owner" {
		owners, err := h.ownerCount(r.Context(), p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Update member failed", err.Error())
			return
		}
		if owners < 2 {
			problem.Write(w, 400, "Each workspace must keep at least one owner", "")
			return
		}
	}
	_, err = h.DB.Exec(r.Context(), `update member set role=$1, updated_at=now() where id=$2::uuid`, input.Role, input.ID)
	if err != nil {
		problem.Write(w, 500, "Update member failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) updateInvitationRole(w http.ResponseWriter, r *http.Request, p auth.Principal, input mutateMemberRequest) {
	if input.Action == "resend" {
		if err := h.rotateInvitationToken(r.Context(), p.WorkspaceID, input.ID); errors.Is(err, pgx.ErrNoRows) {
			problem.Write(w, 404, "Pending invitation not found", "")
		} else if err != nil {
			problem.Write(w, 500, "Resend invitation failed", err.Error())
		} else {
			problem.JSON(w, 200, map[string]bool{"success": true})
		}
		return
	}
	if p.Role != "owner" && input.Role == "owner" {
		problem.Write(w, 403, "Only owners can assign the owner role", "")
		return
	}
	cmd, err := h.DB.Exec(r.Context(), `update workspace_invitation set role=$1, updated_at=now() where id=$2::uuid and workspace_id=$3::uuid and status='pending'`, input.Role, input.ID, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update invitation failed", err.Error())
		return
	}
	if cmd.RowsAffected() == 0 {
		problem.Write(w, 404, "Pending invitation not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) removeMember(w http.ResponseWriter, r *http.Request, p auth.Principal, memberID string) {
	var userID, role string
	err := h.DB.QueryRow(r.Context(), `select user_id, role::text from member where id=$1::uuid and workspace_id=$2::uuid`, memberID, p.WorkspaceID).Scan(&userID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Member not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Remove member failed", err.Error())
		return
	}
	if userID == p.UserID {
		problem.Write(w, 400, "Use your account settings to leave this workspace", "")
		return
	}
	if p.Role != "owner" && role == "owner" {
		problem.Write(w, 403, "Only owners can remove owners", "")
		return
	}
	if role == "owner" {
		owners, err := h.ownerCount(r.Context(), p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Remove member failed", err.Error())
			return
		}
		if owners < 2 {
			problem.Write(w, 400, "Each workspace must keep at least one owner", "")
			return
		}
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Remove member failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `delete from team_member tm using team t where tm.team_id=t.id and t.workspace_id=$1::uuid and tm.user_id=$2`, p.WorkspaceID, userID); err != nil {
		problem.Write(w, 500, "Remove member failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from member where id=$1::uuid`, memberID); err != nil {
		problem.Write(w, 500, "Remove member failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Remove member failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) emailIsMember(ctx context.Context, workspaceID string, email string) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from member m join "user" u on u.id=m.user_id where m.workspace_id=$1::uuid and lower(u.email)=lower($2) limit 1`, workspaceID, email).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (h Handler) ownerCount(ctx context.Context, workspaceID string) (int, error) {
	var count int
	err := h.DB.QueryRow(ctx, `select count(*) from member where workspace_id=$1::uuid and role='owner'`, workspaceID).Scan(&count)
	return count, err
}

func (h Handler) rotateInvitationToken(ctx context.Context, workspaceID, id string) error {
	var email, role string
	err := h.DB.QueryRow(ctx, `select email, role::text from workspace_invitation where id=$1::uuid and workspace_id=$2::uuid and status='pending'`, id, workspaceID).Scan(&email, &role)
	if err != nil {
		return err
	}
	token := createInviteToken(workspaceID, email, role)
	cmd, err := h.DB.Exec(ctx, `update workspace_invitation set token=$1, updated_at=now() where id=$2::uuid`, token, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (h Handler) nextTeamKey(ctx context.Context, tx pgx.Tx, name string) (string, error) {
	base := teamKeyBase(name)
	rows, err := tx.Query(ctx, `select key from team where key like $1 || '%'`, base)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	used := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return "", err
		}
		used[key] = true
	}
	if !used[base] {
		return base, nil
	}
	for i := 2; i < 1000; i++ {
		candidate := fmt.Sprintf("%s%d", base, i)
		if !used[candidate] {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("unable to allocate team key")
}

func insertDefaultWorkflowStates(ctx context.Context, tx pgx.Tx, teamID string) error {
	states := []struct {
		Name      string
		Category  string
		Color     string
		Position  float32
		IsDefault bool
	}{
		{"Backlog", "backlog", "#bec2c8", 1000, true},
		{"Todo", "unstarted", "#bec2c8", 2000, true},
		{"In Progress", "started", "#f2c94c", 3000, true},
		{"Done", "completed", "#27ae60", 4000, true},
		{"Canceled", "canceled", "#828282", 5000, true},
	}
	for _, state := range states {
		if _, err := tx.Exec(ctx, `insert into workflow_state (team_id, name, category, color, position, is_default) values ($1::uuid,$2,$3,$4,$5,$6)`, teamID, state.Name, state.Category, state.Color, state.Position, state.IsDefault); err != nil {
			return err
		}
	}
	return nil
}

func applyWorkspaceSettings(ws *Workspace, raw []byte) {
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	ws.Region = stringSetting(settings, "region", "United States")
	ws.FiscalMonth = stringSetting(settings, "fiscalMonth", "january")
	if !supportedFiscalMonth(ws.FiscalMonth) {
		ws.FiscalMonth = "january"
	}
	ws.Plan = stringSetting(settings, "plan", "free")
	ws.WelcomeMessage = stringSetting(settings, "welcomeMessage", "")
}

func applyProfileSettings(entry *memberEntry, raw []byte) {
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	profile, _ := settings["profile"].(map[string]any)
	entry.Pronouns = stringSetting(profile, "pronouns", "")
	entry.Title = stringSetting(profile, "title", "")
	entry.Location = stringSetting(profile, "location", "")
	entry.Timezone = stringSetting(profile, "timezone", "")
	if v, ok := profile["showLocalTime"].(bool); ok {
		entry.ShowLocalTime = v
	}
}

func stringSetting(settings map[string]any, key string, fallback string) string {
	if value, ok := settings[key].(string); ok && strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func createInviteToken(workspaceID, email, role string) string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s:%s:%s:%d", workspaceID, email, role, time.Now().UnixNano())
	}
	return "inv_" + hex.EncodeToString(buf)
}

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

func sanitizeSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = slugRe.ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func validateWorkspaceName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("Name is required")
	}
	if len(name) > 255 {
		return fmt.Errorf("Name must be 255 characters or fewer")
	}
	return nil
}

func validateSlug(slug string) error {
	if len(slug) < 2 || len(slug) > 63 {
		return fmt.Errorf("URL slug must be between 2 and 63 characters")
	}
	if slug != sanitizeSlug(slug) {
		return fmt.Errorf("URL slug can only contain lowercase letters, numbers, and hyphens")
	}
	return nil
}

func teamKeyBase(name string) string {
	parts := strings.FieldsFunc(strings.ToUpper(name), func(r rune) bool { return r < 'A' || r > 'Z' })
	if len(parts) == 0 {
		return "WRK"
	}
	if len(parts) == 1 {
		word := parts[0]
		if len(word) > 3 {
			word = word[:3]
		}
		for len(word) < 3 {
			word += "X"
		}
		return word
	}
	key := ""
	for _, part := range parts {
		if part != "" && len(key) < 3 {
			key += part[:1]
		}
	}
	for len(key) < 3 {
		key += "X"
	}
	return key
}

func isManager(role string) bool { return role == "owner" || role == "admin" }
func canInvite(role string) bool { return isManager(role) }
func validRole(role string) bool {
	return role == "owner" || role == "admin" || role == "member" || role == "guest"
}
func validInviteRole(role string) bool { return role == "admin" || role == "member" || role == "guest" }

func supportedFiscalMonth(value string) bool {
	switch value {
	case "january", "february", "march", "april", "july", "october":
		return true
	default:
		return false
	}
}

func isSupportedLogo(value string) bool {
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || strings.HasPrefix(strings.ToLower(value), "data:image/")
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

type timeDest struct{ value *string }

func tsScanner(dest *string) *timeDest { return &timeDest{value: dest} }

func (d *timeDest) Scan(src any) error {
	switch value := src.(type) {
	case time.Time:
		*d.value = value.UTC().Format(time.RFC3339Nano)
		return nil
	case string:
		*d.value = value
		return nil
	default:
		return fmt.Errorf("unsupported timestamp %T", src)
	}
}

type importCSVRow struct {
	row     int
	headers []string
	cols    []string
}

func (r importCSVRow) get(name string) string {
	if name == "" {
		return ""
	}
	for idx, header := range r.headers {
		if header == name && idx < len(r.cols) {
			return r.cols[idx]
		}
	}
	return ""
}

func parseImportCSV(text string) []importCSVRow {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	clean := []string{}
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) != "" {
			clean = append(clean, line)
		}
	}
	if len(clean) == 0 {
		return nil
	}
	headers := splitImportCSVLine(clean[0])
	rows := []importCSVRow{}
	for idx, line := range clean[1:] {
		rows = append(rows, importCSVRow{row: idx + 2, headers: headers, cols: splitImportCSVLine(line)})
	}
	return rows
}

func splitImportCSVLine(line string) []string {
	parts := strings.Split(line, ",")
	for idx, part := range parts {
		parts[idx] = strings.Trim(strings.TrimSpace(part), "\"")
	}
	return parts
}

func stringFromMap(m map[string]any, key string) string {
	if value, ok := m[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func (h Handler) teamInWorkspace(ctx context.Context, teamID string, workspaceID string) bool {
	var found string
	err := h.DB.QueryRow(ctx, `select id::text from team where id=$1::uuid and workspace_id=$2::uuid limit 1`, teamID, workspaceID).Scan(&found)
	return err == nil
}

func (h Handler) workflowStateNames(ctx context.Context, teamID string) (map[string]bool, error) {
	rows, err := h.DB.Query(ctx, `select name from workflow_state where team_id=$1::uuid`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[strings.ToLower(name)] = true
	}
	return out, rows.Err()
}

func (h Handler) billingResponse(ctx context.Context, p auth.Principal) (billingResponse, error) {
	var ws billingWorkspace
	var raw []byte
	err := h.DB.QueryRow(ctx, `
		select w.id::text, w.name, w.url_slug, coalesce(w.settings,'{}'::jsonb), m.role::text
		from workspace w join member m on m.workspace_id=w.id and m.user_id=$1
		where w.id=$2::uuid limit 1`, p.UserID, p.WorkspaceID).Scan(&ws.ID, &ws.Name, &ws.URLSlug, &raw, &ws.Role)
	if err != nil {
		return billingResponse{}, err
	}
	settings := mapFromJSON(raw)
	state := readBillingState(settings)
	return billingResponse{Workspace: ws, CurrentPlan: state.plan, CanManage: isManager(ws.Role), Usage: billingUsage{SeatsUsed: state.seatsUsed, IssuesUsed: state.issuesUsed, IssueLimit: state.usageLimit}, Plans: billingPlans(), PaymentMethods: state.paymentMethods, Invoices: state.invoices}, nil
}

func (h Handler) workspaceSettings(ctx context.Context, workspaceID string) (map[string]any, error) {
	var raw []byte
	err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return mapFromJSON(raw), nil
}

type billingState struct {
	plan           string
	seatsUsed      int
	issuesUsed     int
	usageLimit     int
	paymentMethods []any
	invoices       []any
}

func readBillingState(settings map[string]any) billingState {
	billing := recordFromAny(settings["billing"])
	return billingState{plan: normalizeBillingPlan(firstNonNil(billing["plan"], settings["plan"])), seatsUsed: intValue(billing["seatsUsed"], 3), issuesUsed: intValue(billing["issuesUsed"], 42), usageLimit: intValue(billing["usageLimit"], 250), paymentMethods: arrayOrDefault(billing["paymentMethods"], defaultPaymentMethods()), invoices: arrayOrDefault(billing["invoices"], defaultInvoices())}
}

func normalizeBillingPlan(value any) string {
	if value == "standard" || value == "plus" {
		return "business"
	}
	if s, ok := value.(string); ok {
		switch s {
		case "free", "basic", "business", "enterprise":
			return s
		}
	}
	return "free"
}

func billingPlans() []billingPlan {
	return []billingPlan{{ID: "free", Name: "Free", Price: "$0", Description: "For individuals and small trials.", Features: []string{"3 members", "250 issues", "Basic workspace settings"}}, {ID: "basic", Name: "Basic", Price: "$8/user/month", Description: "Core issue tracking for focused teams.", Features: []string{"Unlimited issues", "5 teams", "Basic automations"}}, {ID: "business", Name: "Business", Price: "$14/user/month", Description: "Advanced controls for growing organizations.", Features: []string{"Unlimited teams", "Admin controls", "Priority support"}}, {ID: "enterprise", Name: "Enterprise", Price: "Custom", Description: "Security, scale, and support for large companies.", Features: []string{"SAML/SCIM", "Audit exports", "Dedicated support"}}}
}

func defaultPaymentMethods() []any {
	return []any{map[string]any{"id": "pm_dev_visa", "brand": "Visa", "last4": "4242", "expMonth": 12, "expYear": 2030, "isDefault": true}}
}

func defaultInvoices() []any {
	return []any{map[string]any{"id": "inv_dev_001", "number": "DEV-001", "date": "2026-05-01", "amount": "$0.00", "status": "paid"}}
}

func mapFromJSON(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func recordFromAny(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func intValue(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	default:
		return fallback
	}
}

func arrayOrDefault(value any, fallback []any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return fallback
}

func normalizeWorkspaceDocuments(settings map[string]any) workspaceDocumentsSettings {
	documents := recordFromAny(settings["documents"])
	visibility := "workspace"
	if documents["defaultVisibility"] == "private" {
		visibility = "private"
	}
	autoLink := true
	if value, ok := documents["autoLinkProjectDocuments"].(bool); ok {
		autoLink = value
	}
	templates := []workspaceDocumentTemplate{}
	if rawTemplates, ok := documents["templates"].([]any); ok {
		for _, raw := range rawTemplates {
			template := recordFromAny(raw)
			id := asStringValue(template["id"])
			name := asStringValue(template["name"])
			if id == "" || name == "" {
				continue
			}
			templates = append(templates, workspaceDocumentTemplate{ID: id, Name: name, Description: asStringValue(template["description"])})
		}
	}
	return workspaceDocumentsSettings{DefaultVisibility: visibility, AutoLinkProjectDocuments: autoLink, Templates: templates}
}

func (h Handler) saveWorkspaceDocuments(ctx context.Context, workspaceID string, settings map[string]any, documents workspaceDocumentsSettings) error {
	settings["documents"] = documents
	body, _ := json.Marshal(settings)
	_, err := h.DB.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, workspaceID)
	return err
}

func asStringValue(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func createRandomID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + hex.EncodeToString(buf)
}

const defaultConfirmationMessage = "Thanks for the feedback — our product team will review it."

func readCollaborationSettings(settings map[string]any) collaborationSettings {
	collaboration := recordFromAny(settings["collaboration"])
	asks := recordFromAny(collaboration["asks"])
	pulse := recordFromAny(collaboration["pulse"])
	customerRequests := recordFromAny(collaboration["customerRequests"])
	return collaborationSettings{Asks: asksSettings{Enabled: boolFromAny(asks["enabled"], false), IntakeEmail: asStringValue(asks["intakeEmail"]), DefaultPriority: priorityValue(asks["defaultPriority"], "medium"), AutoAssign: boolFromAny(asks["autoAssign"], true)}, Pulse: pulseSettings{Enabled: boolFromAny(pulse["enabled"], true), DigestFrequency: digestFrequencyValue(pulse["digestFrequency"], "weekly"), BurnoutAlerts: boolFromAny(pulse["burnoutAlerts"], true), VelocityTarget: positiveIntValue(pulse["velocityTarget"], 40, 0)}, CustomerRequests: customerRequestSettings{Enabled: boolFromAny(customerRequests["enabled"], false), IntakeEmail: asStringValue(customerRequests["intakeEmail"]), DefaultPriority: priorityValue(customerRequests["defaultPriority"], "medium"), AutoLinkIssues: boolFromAny(customerRequests["autoLinkIssues"], true), RequireCompany: boolFromAny(customerRequests["requireCompany"], false), ConfirmationMessage: nonEmptyString(customerRequests["confirmationMessage"], defaultConfirmationMessage)}}
}

func mergeCollaborationSettings(settings map[string]any, body map[string]any) map[string]any {
	current := readCollaborationSettings(settings)
	asks := recordFromAny(body["asks"])
	pulse := recordFromAny(body["pulse"])
	customerRequests := recordFromAny(body["customerRequests"])
	if v, ok := asks["enabled"].(bool); ok {
		current.Asks.Enabled = v
	}
	if v, ok := asks["intakeEmail"].(string); ok {
		current.Asks.IntakeEmail = truncate(strings.TrimSpace(v), 120)
	}
	if v, ok := asks["defaultPriority"].(string); ok && validPriorityValue(v) {
		current.Asks.DefaultPriority = v
	}
	if v, ok := asks["autoAssign"].(bool); ok {
		current.Asks.AutoAssign = v
	}
	if v, ok := pulse["enabled"].(bool); ok {
		current.Pulse.Enabled = v
	}
	if v, ok := pulse["digestFrequency"].(string); ok && validDigestFrequency(v) {
		current.Pulse.DigestFrequency = v
	}
	if v, ok := pulse["burnoutAlerts"].(bool); ok {
		current.Pulse.BurnoutAlerts = v
	}
	if value := positiveIntValue(pulse["velocityTarget"], 0, 500); value > 0 {
		current.Pulse.VelocityTarget = value
	}
	if v, ok := customerRequests["enabled"].(bool); ok {
		current.CustomerRequests.Enabled = v
	}
	if v, ok := customerRequests["intakeEmail"].(string); ok {
		current.CustomerRequests.IntakeEmail = truncate(strings.TrimSpace(v), 120)
	}
	if v, ok := customerRequests["defaultPriority"].(string); ok && validPriorityValue(v) {
		current.CustomerRequests.DefaultPriority = v
	}
	if v, ok := customerRequests["autoLinkIssues"].(bool); ok {
		current.CustomerRequests.AutoLinkIssues = v
	}
	if v, ok := customerRequests["requireCompany"].(bool); ok {
		current.CustomerRequests.RequireCompany = v
	}
	if v, ok := customerRequests["confirmationMessage"].(string); ok {
		current.CustomerRequests.ConfirmationMessage = truncate(strings.TrimSpace(v), 240)
	}
	return map[string]any{
		"asks": map[string]any{
			"enabled":         current.Asks.Enabled,
			"intakeEmail":     current.Asks.IntakeEmail,
			"defaultPriority": current.Asks.DefaultPriority,
			"autoAssign":      current.Asks.AutoAssign,
		},
		"pulse": map[string]any{
			"enabled":         current.Pulse.Enabled,
			"digestFrequency": current.Pulse.DigestFrequency,
			"burnoutAlerts":   current.Pulse.BurnoutAlerts,
			"velocityTarget":  current.Pulse.VelocityTarget,
		},
		"customerRequests": map[string]any{
			"enabled":             current.CustomerRequests.Enabled,
			"intakeEmail":         current.CustomerRequests.IntakeEmail,
			"defaultPriority":     current.CustomerRequests.DefaultPriority,
			"autoLinkIssues":      current.CustomerRequests.AutoLinkIssues,
			"requireCompany":      current.CustomerRequests.RequireCompany,
			"confirmationMessage": current.CustomerRequests.ConfirmationMessage,
		},
	}
}

func boolFromAny(value any, fallback bool) bool {
	if v, ok := value.(bool); ok {
		return v
	}
	return fallback
}
func positiveIntValue(value any, fallback int, max int) int {
	n := intValue(value, fallback)
	if n <= 0 {
		return fallback
	}
	if max > 0 && n > max {
		return fallback
	}
	return n
}
func nonEmptyString(value any, fallback string) string {
	if s := strings.TrimSpace(asStringValue(value)); s != "" {
		return s
	}
	return fallback
}
func priorityValue(value any, fallback string) string {
	if s, ok := value.(string); ok && validPriorityValue(s) {
		return s
	}
	return fallback
}
func validPriorityValue(value string) bool {
	return value == "low" || value == "medium" || value == "high" || value == "urgent"
}
func digestFrequencyValue(value any, fallback string) string {
	if s, ok := value.(string); ok && validDigestFrequency(s) {
		return s
	}
	return fallback
}
func validDigestFrequency(value string) bool {
	return value == "daily" || value == "weekly" || value == "off"
}

func readInitiativeSettings(settings map[string]any) workspaceInitiativeSettings {
	features := recordFromAny(settings["features"])
	initiatives := recordFromAny(features["initiatives"])
	visibility := "workspace"
	if initiatives["visibility"] == "teams" {
		visibility = "teams"
	}
	roadmapMode := "all"
	if initiatives["roadmapMode"] == "selected" {
		roadmapMode = "selected"
	}
	return workspaceInitiativeSettings{Enabled: boolFromAny(initiatives["enabled"], true), ProjectRollups: boolFromAny(initiatives["projectRollups"], true), Visibility: visibility, RoadmapMode: roadmapMode}
}

func patchInitiativeSettings(current workspaceInitiativeSettings, patch map[string]any) (workspaceInitiativeSettings, error) {
	if value, ok := patch["enabled"]; ok {
		b, ok := value.(bool)
		if !ok {
			return current, fmt.Errorf("Initiative availability must be a boolean")
		}
		current.Enabled = b
	}
	if value, ok := patch["projectRollups"]; ok {
		b, ok := value.(bool)
		if !ok {
			return current, fmt.Errorf("Project rollups must be a boolean")
		}
		current.ProjectRollups = b
	}
	if value, ok := patch["visibility"]; ok {
		s, ok := value.(string)
		if !ok || (s != "workspace" && s != "teams") {
			return current, fmt.Errorf("Visibility must be workspace or teams")
		}
		current.Visibility = s
	}
	if value, ok := patch["roadmapMode"]; ok {
		s, ok := value.(string)
		if !ok || (s != "all" && s != "selected") {
			return current, fmt.Errorf("Roadmap mode must be all or selected")
		}
		current.RoadmapMode = s
	}
	return current, nil
}

func buildAISettingsResponse(settings map[string]any, role string) aiSettingsResponse {
	ai := readWorkspaceAISettings(settings)
	return aiSettingsResponse{AISettings: ai, Capabilities: aiCapabilities{CanManageAiSettings: isManager(role), CanUseAgents: canUseWorkspaceAgents(role, ai)}, Limits: aiLimits{WorkspaceAgentGuidanceMaxLength: workspaceAgentGuidanceMaxLength}}
}

func readWorkspaceAISettings(settings map[string]any) workspaceAISettings {
	rootAI := recordFromAny(settings["ai"])
	legacyAgents := recordFromAny(settings["agents"])
	guidance := firstString(rootAI["workspaceAgentGuidance"], rootAI["agentGuidance"], rootAI["guidance"], legacyAgents["agentGuidance"], legacyAgents["guidance"], settings["agentGuidance"])
	if len(guidance) > workspaceAgentGuidanceMaxLength {
		guidance = guidance[:workspaceAgentGuidanceMaxLength]
	}
	return workspaceAISettings{AIFeaturesEnabled: boolFromAny(firstNonNil(rootAI["aiFeaturesEnabled"], rootAI["enabled"]), true), AskLinearEnabled: boolFromAny(rootAI["askLinearEnabled"], true), IssueSuggestionsEnabled: boolFromAny(rootAI["issueSuggestionsEnabled"], true), SummariesEnabled: boolFromAny(rootAI["summariesEnabled"], true), AutoTriageEnabled: boolFromAny(rootAI["autoTriageEnabled"], false), WorkspaceAgentGuidance: strings.TrimSpace(guidance), AgentUsagePermission: permissionLevel(rootAI["agentUsagePermission"], "members")}
}

func patchAISettings(current workspaceAISettings, patch map[string]any) workspaceAISettings {
	if v, ok := patch["aiFeaturesEnabled"].(bool); ok {
		current.AIFeaturesEnabled = v
	}
	if v, ok := patch["askLinearEnabled"].(bool); ok {
		current.AskLinearEnabled = v
	}
	if v, ok := patch["issueSuggestionsEnabled"].(bool); ok {
		current.IssueSuggestionsEnabled = v
	}
	if v, ok := patch["summariesEnabled"].(bool); ok {
		current.SummariesEnabled = v
	}
	if v, ok := patch["autoTriageEnabled"].(bool); ok {
		current.AutoTriageEnabled = v
	}
	if v, ok := patch["workspaceAgentGuidance"].(string); ok {
		current.WorkspaceAgentGuidance = strings.TrimSpace(v)
	}
	if v, ok := patch["agentUsagePermission"].(string); ok {
		current.AgentUsagePermission = permissionLevel(v, current.AgentUsagePermission)
	}
	return current
}

func serializeWorkspaceAISettings(settings workspaceAISettings) map[string]any {
	return map[string]any{"aiFeaturesEnabled": settings.AIFeaturesEnabled, "askLinearEnabled": settings.AskLinearEnabled, "issueSuggestionsEnabled": settings.IssueSuggestionsEnabled, "summariesEnabled": settings.SummariesEnabled, "autoTriageEnabled": settings.AutoTriageEnabled, "workspaceAgentGuidance": settings.WorkspaceAgentGuidance, "agentGuidance": settings.WorkspaceAgentGuidance, "agentUsagePermission": settings.AgentUsagePermission}
}

func permissionLevel(value any, fallback string) string {
	if s, ok := value.(string); ok && (s == "admins" || s == "members" || s == "anyone") {
		return s
	}
	return fallback
}

func canUseWorkspaceAgents(role string, settings workspaceAISettings) bool {
	if !settings.AIFeaturesEnabled {
		return false
	}
	switch settings.AgentUsagePermission {
	case "admins":
		return isManager(role)
	case "members", "anyone":
		return role == "owner" || role == "admin" || role == "member"
	default:
		return false
	}
}

func firstString(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok {
			return s
		}
	}
	return ""
}

func readSLASettings(settings map[string]any) slaSettings {
	sla := recordFromAny(settings["sla"])
	policies := []slaPolicy{}
	if rawPolicies, ok := sla["policies"].([]any); ok {
		for _, raw := range rawPolicies {
			policy, ok := readSLAPolicy(raw)
			if ok {
				policies = append(policies, policy)
			}
		}
	}
	return slaSettings{Policies: policies}
}

func readSLAPolicy(raw any) (slaPolicy, bool) {
	record := recordFromAny(raw)
	id := asStringValue(record["id"])
	name := asStringValue(record["name"])
	if id == "" || name == "" {
		return slaPolicy{}, false
	}
	policy, err := normalizeSLAPolicyInput(record)
	if err != nil {
		return slaPolicy{}, false
	}
	policy.ID = id
	policy.CreatedAt = nonEmptyString(record["createdAt"], time.Unix(0, 0).UTC().Format(time.RFC3339))
	policy.UpdatedAt = nonEmptyString(record["updatedAt"], time.Unix(0, 0).UTC().Format(time.RFC3339))
	return policy, true
}

func normalizeSLAPolicyInput(input map[string]any) (slaPolicy, error) {
	name := truncate(strings.TrimSpace(asStringValue(input["name"])), 80)
	if name == "" {
		return slaPolicy{}, fmt.Errorf("Name is required")
	}
	response := positiveFloatHours(input["responseTimeHours"], 4)
	resolution := positiveFloatHours(input["resolutionTimeHours"], 24)
	if response > resolution {
		return slaPolicy{}, fmt.Errorf("Response target must be less than or equal to resolution target")
	}
	var description *string
	if text := truncate(strings.TrimSpace(asStringValue(input["description"])), 240); text != "" {
		description = &text
	}
	return slaPolicy{Name: name, Description: description, ResponseTimeHours: response, ResolutionTimeHours: resolution, Enabled: input["enabled"] != false, Conditions: normalizeSLAConditions(input["conditions"])}, nil
}

func normalizeSLAConditions(raw any) slaPolicyCondition {
	record := recordFromAny(raw)
	condition := slaPolicyCondition{}
	if s := asStringValue(record["priority"]); s == "urgent" || s == "high" || s == "medium" || s == "low" {
		condition.Priority = &s
	}
	if s := strings.ToUpper(truncate(strings.TrimSpace(asStringValue(record["teamKey"])), 12)); s != "" {
		condition.TeamKey = &s
	}
	return condition
}

func positiveFloatHours(value any, fallback float64) float64 {
	var f float64
	switch v := value.(type) {
	case float64:
		f = v
	case float32:
		f = float64(v)
	case int:
		f = float64(v)
	case int32:
		f = float64(v)
	case int64:
		f = float64(v)
	case string:
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fallback
		}
		f = parsed
	default:
		return fallback
	}
	if f <= 0 {
		return fallback
	}
	return math.Round(f*100) / 100
}

func (h Handler) saveSLASettings(ctx context.Context, workspaceID string, settings map[string]any, sla slaSettings) error {
	existing := recordFromAny(settings["sla"])
	existing["policies"] = sla.Policies
	settings["sla"] = existing
	raw, _ := json.Marshal(settings)
	_, err := h.DB.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, workspaceID)
	return err
}

func policyToMap(policy slaPolicy) map[string]any {
	conditions := map[string]any{}
	if policy.Conditions.Priority != nil {
		conditions["priority"] = *policy.Conditions.Priority
	}
	if policy.Conditions.TeamKey != nil {
		conditions["teamKey"] = *policy.Conditions.TeamKey
	}
	return map[string]any{"name": policy.Name, "description": policy.Description, "responseTimeHours": policy.ResponseTimeHours, "resolutionTimeHours": policy.ResolutionTimeHours, "enabled": policy.Enabled, "conditions": conditions}
}

func normalizeApplicationScopes(raw []byte) []string {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return []string{}
	}
	return normalizeApplicationScopesValue(value)
}

func normalizeApplicationScopesValue(value any) []string {
	out := []string{}
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	case []string:
		for _, s := range v {
			if strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	case string:
		for _, s := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
			if strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	}
	return out
}

func buildApplicationPermissionGroups(scopes []string) []permissionGroup {
	groups := map[string][]string{}
	order := []string{}
	for _, scope := range scopes {
		group, description := applicationScopePresentation(scope)
		if _, ok := groups[group]; !ok {
			order = append(order, group)
		}
		groups[group] = append(groups[group], description)
	}
	out := []permissionGroup{}
	for _, label := range order {
		out = append(out, permissionGroup{Label: label, Descriptions: groups[label]})
	}
	return out
}

func applicationScopePresentation(scope string) (string, string) {
	switch scope {
	case "read":
		return "Workspace data", "View workspace and account information"
	case "write":
		return "Workspace data", "Create and update workspace data"
	case "issues:read":
		return "Issues", "View issues and related metadata"
	case "issues:write":
		return "Issues", "Create and update issues"
	case "comments:read":
		return "Comments", "View comments"
	case "comments:write":
		return "Comments", "Create and update comments"
	case "webhooks:read":
		return "Webhooks", "View webhook subscriptions"
	case "webhooks:write":
		return "Webhooks", "Manage webhook subscriptions"
	default:
		return "Additional access", humanizeApplicationScope(scope)
	}
}

func humanizeApplicationScope(scope string) string {
	parts := strings.FieldsFunc(scope, func(r rune) bool { return r == ':' || r == '_' || r == '.' || r == '-' })
	for i, part := range parts {
		if part != "" {
			parts[i] = strings.ToUpper(part[:1]) + part[1:]
		}
	}
	return strings.Join(parts, " ")
}

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func readSAMLSettings(settings map[string]any) samlSettings {
	security := recordFromAny(settings["security"])
	saml := recordFromAny(firstNonNil(security["saml"], settings["saml"], settings["sso"]))
	url := firstString(saml["idpSsoUrl"], saml["ssoUrl"], saml["ssoURL"], saml["url"])
	hasConfig := url != "" || asStringValue(saml["entityId"]) != "" || asStringValue(saml["certificate"]) != "" || asStringValue(saml["metadataUrl"]) != ""
	return samlSettings{Enabled: boolFromAny(saml["enabled"], false), Domains: normalizeSAMLDomainList(firstNonNil(saml["domains"], saml["emailDomains"])), IDPSSOURL: url, EntityID: asStringValue(saml["entityId"]), Certificate: asStringValue(saml["certificate"]), MetadataURL: asStringValue(saml["metadataUrl"]), LastTestedAt: nullableStringPtr(saml["lastTestedAt"]), Status: samlStatus(saml["status"], hasConfig), LastError: nullableStringPtr(saml["lastError"])}
}

func normalizeSAMLInput(input map[string]any, current samlSettings) samlSettings {
	next := current
	if v, ok := input["enabled"].(bool); ok {
		next.Enabled = v
	}
	if _, ok := input["domains"]; ok {
		next.Domains = normalizeSAMLDomainList(input["domains"])
	}
	if _, ok := input["idpSsoUrl"]; ok {
		next.IDPSSOURL = strings.TrimSpace(asStringValue(input["idpSsoUrl"]))
	}
	if _, ok := input["entityId"]; ok {
		next.EntityID = strings.TrimSpace(asStringValue(input["entityId"]))
	}
	if _, ok := input["certificate"]; ok {
		next.Certificate = strings.TrimSpace(asStringValue(input["certificate"]))
	}
	if _, ok := input["metadataUrl"]; ok {
		next.MetadataURL = strings.TrimSpace(asStringValue(input["metadataUrl"]))
	}
	if next.IDPSSOURL == "" && next.MetadataURL == "" && next.EntityID == "" && next.Certificate == "" {
		next.Status = "not_configured"
		next.LastError = nil
	} else if input["status"] == "verified" || input["test"] == true {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		next.Status = "verified"
		next.LastTestedAt = &now
		next.LastError = nil
	} else if next.Status == "not_configured" {
		next.Status = "configured"
	}
	return next
}

func validateSAMLSettings(settings samlSettings) string {
	if err := validateHTTPURL(settings.IDPSSOURL, "IdP SSO URL", settings.Enabled); err != "" {
		return err
	}
	if err := validateHTTPURL(settings.MetadataURL, "Metadata URL", false); err != "" {
		return err
	}
	if settings.Enabled && len(settings.Domains) == 0 {
		return "At least one SAML email domain is required before enabling SAML."
	}
	if settings.Enabled && strings.TrimSpace(settings.EntityID) == "" {
		return "IdP entity ID is required before enabling SAML."
	}
	if settings.Enabled && strings.TrimSpace(settings.Certificate) == "" && strings.TrimSpace(settings.MetadataURL) == "" {
		return "Certificate or metadata URL is required before enabling SAML."
	}
	return ""
}

func validateHTTPURL(value string, label string, required bool) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		if required {
			return label + " is required."
		}
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return label + " must be a valid URL."
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return label + " must be an http or https URL."
	}
	return ""
}

func normalizeSAMLDomainList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		domain := normalizeSAMLDomain(asStringValue(item))
		if domain != "" && !seen[domain] {
			seen[domain] = true
			out = append(out, domain)
		}
	}
	return out
}

func normalizeSAMLDomain(value string) string {
	domain := strings.TrimLeft(strings.ToLower(strings.TrimSpace(value)), "@")
	if ok, _ := regexp.MatchString(`^[a-z0-9.-]+\.[a-z]{2,}$`, domain); !ok {
		return ""
	}
	return domain
}

func samlStatus(value any, hasConfig bool) string {
	if s, ok := value.(string); ok && (s == "configured" || s == "verified" || s == "error") {
		return s
	}
	if hasConfig {
		return "configured"
	}
	return "not_configured"
}

func readSCIMSettings(settings map[string]any, baseURL string) scimSettings {
	security := recordFromAny(settings["security"])
	scim := recordFromAny(firstNonNil(security["scim"], settings["scim"]))
	enabled := boolFromAny(scim["enabled"], false)
	storedBase := asStringValue(scim["baseUrl"])
	if storedBase == "" {
		storedBase = baseURL
	}
	status := "disabled"
	if enabled {
		status = "enabled"
	}
	return scimSettings{Enabled: enabled, BaseURL: storedBase, Tokens: readSCIMTokens(scim["tokens"]), LastSyncAt: nullableStringPtr(scim["lastSyncAt"]), Status: status}
}

func readSCIMTokens(value any) []scimToken {
	items, ok := value.([]any)
	if !ok {
		return []scimToken{}
	}
	out := []scimToken{}
	for _, item := range items {
		record := recordFromAny(item)
		id := asStringValue(record["id"])
		hash := asStringValue(record["tokenHash"])
		if id == "" || hash == "" {
			continue
		}
		out = append(out, scimToken{ID: id, Name: nonEmptyString(record["name"], "SCIM token"), Prefix: nonEmptyString(record["prefix"], "scim_••••••"), TokenHash: hash, CreatedAt: nonEmptyString(record["createdAt"], time.Unix(0, 0).UTC().Format(time.RFC3339)), RevokedAt: nullableStringPtr(record["revokedAt"]), LastUsedAt: nullableStringPtr(record["lastUsedAt"])})
	}
	return out
}

func createSCIMToken(name string) (string, scimToken) {
	secretBytes := make([]byte, 24)
	_, _ = rand.Read(secretBytes)
	secret := "scim_" + base64.RawURLEncoding.EncodeToString(secretBytes)
	idBytes := make([]byte, 12)
	_, _ = rand.Read(idBytes)
	name = truncate(strings.TrimSpace(name), 80)
	if name == "" {
		name = "SCIM token"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return secret, scimToken{ID: hex.EncodeToString(idBytes), Name: name, Prefix: secret[:12], TokenHash: hashSCIMToken(secret), CreatedAt: now}
}

func hashSCIMToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (h Handler) storeSCIMSettings(ctx context.Context, workspaceID string, settings map[string]any, scim scimSettings) error {
	security := recordFromAny(settings["security"])
	security["scim"] = scim
	settings["security"] = security
	return h.saveWorkspaceSettings(ctx, workspaceID, settings)
}

func (h Handler) saveWorkspaceSettings(ctx context.Context, workspaceID string, settings map[string]any) error {
	raw, _ := json.Marshal(settings)
	_, err := h.DB.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, workspaceID)
	return err
}

func publicSCIM(scim scimSettings) publicScimSettings {
	tokens := []publicScimToken{}
	for _, token := range scim.Tokens {
		tokens = append(tokens, publicToken(token))
	}
	return publicScimSettings{Enabled: scim.Enabled, BaseURL: scim.BaseURL, Tokens: tokens, LastSyncAt: scim.LastSyncAt, Status: scim.Status}
}
func publicToken(token scimToken) publicScimToken {
	return publicScimToken{ID: token.ID, Name: token.Name, Prefix: token.Prefix, CreatedAt: token.CreatedAt, RevokedAt: token.RevokedAt, LastUsedAt: token.LastUsedAt}
}
func nullableStringPtr(value any) *string {
	if s := strings.TrimSpace(asStringValue(value)); s != "" {
		return &s
	}
	return nil
}
func scimBaseURL(r *http.Request, workspaceID string) string {
	return strings.TrimRight(requestOrigin(r), "/") + "/api/scim/" + workspaceID
}
func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.Split(forwarded, ",")[0]
	}
	return scheme + "://" + r.Host
}
