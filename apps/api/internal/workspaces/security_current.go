package workspaces

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type currentWorkspaceSecurityRecord struct {
	ID                   string
	Settings             map[string]any
	InviteLinkEnabled    bool
	InviteLinkToken      *string
	ApprovedEmailDomains []string
	Role                 string
}

func (h Handler) GetCurrentSecurity(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	current, err := h.currentSecurityRecord(r, p)
	if err != nil {
		problem.Write(w, 500, "Get workspace security failed", err.Error())
		return
	}
	if current.ID == "" {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	inviteToken, err := h.ensureCurrentInviteToken(r, current)
	if err != nil {
		problem.Write(w, 500, "Get workspace security failed", err.Error())
		return
	}
	current.InviteLinkToken = &inviteToken
	problem.JSON(w, 200, h.currentSecurityPayload(r, current))
}

func (h Handler) UpdateCurrentSecurity(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	current, err := h.currentSecurityRecord(r, p)
	if err != nil {
		problem.Write(w, 500, "Update workspace security failed", err.Error())
		return
	}
	if current.ID == "" {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if !isManager(current.Role) {
		problem.Write(w, 403, "You do not have permission to manage workspace security", "")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON body", err.Error())
		return
	}
	security := recordFromAny(current.Settings["security"])
	for _, key := range []string{"authentication", "permissions", "restrictFileUploads", "improveAi", "webSearch", "hipaa", "ipRestrictions"} {
		if value, ok := body[key]; ok {
			security[key] = value
		}
	}
	current.Settings["security"] = security
	inviteEnabled := current.InviteLinkEnabled
	if value, ok := body["inviteLinkEnabled"].(bool); ok {
		inviteEnabled = value
	}
	approvedDomains := current.ApprovedEmailDomains
	if value, ok := body["approvedEmailDomains"].([]any); ok {
		approvedDomains = stringSliceFromAny(value)
	}
	inviteToken := current.InviteLinkToken
	if inviteToken == nil || *inviteToken == "" {
		created := randomHex(24)
		inviteToken = &created
	}
	if _, err := h.DB.Exec(r.Context(), `update workspace set invite_link_enabled=$1, invite_link_token=$2, approved_email_domains=$3, settings=$4, updated_at=now() where id=$5::uuid`, inviteEnabled, inviteToken, approvedDomains, current.Settings, current.ID); err != nil {
		problem.Write(w, 500, "Update workspace security failed", err.Error())
		return
	}
	current.InviteLinkEnabled = inviteEnabled
	current.InviteLinkToken = inviteToken
	current.ApprovedEmailDomains = approvedDomains
	problem.JSON(w, 200, h.currentSecurityPayload(r, current))
}

func (h Handler) currentSecurityRecord(r *http.Request, p auth.Principal) (currentWorkspaceSecurityRecord, error) {
	var current currentWorkspaceSecurityRecord
	var rawSettings, rawDomains []byte
	err := h.DB.QueryRow(r.Context(), `
		select w.id::text, coalesce(w.settings,'{}'::jsonb), coalesce(w.invite_link_enabled,true), w.invite_link_token, coalesce(w.approved_email_domains,'[]'::jsonb), m.role::text
		from workspace w join member m on m.workspace_id=w.id and m.user_id=$2
		where w.id=$1::uuid limit 1`, p.WorkspaceID, p.UserID).Scan(&current.ID, &rawSettings, &current.InviteLinkEnabled, &current.InviteLinkToken, &rawDomains, &current.Role)
	if err != nil {
		return current, err
	}
	current.Settings = map[string]any{}
	_ = json.Unmarshal(rawSettings, &current.Settings)
	_ = json.Unmarshal(rawDomains, &current.ApprovedEmailDomains)
	return current, nil
}

func (h Handler) ensureCurrentInviteToken(r *http.Request, current currentWorkspaceSecurityRecord) (string, error) {
	if current.InviteLinkToken != nil && *current.InviteLinkToken != "" {
		return *current.InviteLinkToken, nil
	}
	token := randomHex(24)
	_, err := h.DB.Exec(r.Context(), `update workspace set invite_link_token=$1, updated_at=now() where id=$2::uuid`, token, current.ID)
	return token, err
}

func (h Handler) currentSecurityPayload(r *http.Request, current currentWorkspaceSecurityRecord) map[string]any {
	security := recordFromAny(current.Settings["security"])
	permissions := recordFromAny(security["permissions"])
	inviteURL := ""
	if current.InviteLinkToken != nil {
		u := *r.URL
		u.Path = "/accept-invite"
		u.RawQuery = "token=" + *current.InviteLinkToken
		inviteURL = u.String()
	}
	return map[string]any{"security": map[string]any{
		"inviteLinkEnabled":    current.InviteLinkEnabled,
		"inviteUrl":            inviteURL,
		"approvedEmailDomains": current.ApprovedEmailDomains,
		"authentication":       firstNonNil(security["authentication"], map[string]any{"google": true, "emailPasskey": true}),
		"permissions":          firstNonNil(security["permissions"], map[string]any{}),
		"restrictFileUploads":  boolSetting(security, "restrictFileUploads", false),
		"improveAi":            boolSetting(security, "improveAi", true),
		"webSearch":            boolSetting(security, "webSearch", true),
		"hipaa":                boolSetting(security, "hipaa", false),
		"ipRestrictions":       firstNonNil(security["ipRestrictions"], []any{}),
		"saml":                 readSAMLSettings(current.Settings),
		"scim":                 publicSCIM(readSCIMSettings(current.Settings, scimBaseURL(r, current.ID))),
		"capabilities": map[string]any{
			"canInviteMembers":            canPermission(current.Role, permissions["invitationsRole"]),
			"canCreateTeams":              canPermission(current.Role, permissions["teamCreationRole"]),
			"canManageWorkspaceLabels":    false,
			"canManageWorkspaceTemplates": false,
			"canCreateApiKeys":            canPermission(current.Role, permissions["apiKeyCreationRole"]),
			"canModifyAgentGuidance":      canPermission(current.Role, permissions["agentGuidanceRole"]),
		},
	}}
}

func stringSliceFromAny(values []any) []string {
	out := []string{}
	for _, value := range values {
		if s, ok := value.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func randomHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func boolSetting(record map[string]any, key string, fallback bool) bool {
	if v, ok := record[key].(bool); ok {
		return v
	}
	return fallback
}
func canPermission(role string, level any) bool {
	if role == "owner" || role == "admin" {
		return true
	}
	return level == "anyone" || level == "members"
}
