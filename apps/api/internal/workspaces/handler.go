package workspaces

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
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
	r.Delete("/current", h.DeleteCurrent)
	r.Get("/members", h.ListMembers)
	r.Patch("/members", h.UpdateMemberOrInvitation)
	r.Post("/members", h.ResendInvitation)
	r.Delete("/members", h.RemoveMemberOrInvitation)
	r.Post("/invite", h.Invite)
	r.Post("/imports/preview", h.PreviewImport)
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
	problem.JSON(w, 201, createWorkspaceResponse{Workspace: ws, Team: team})
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
