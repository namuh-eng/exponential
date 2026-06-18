package workspaces

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	webhookspkg "github.com/namuh-eng/exponential/apps/api/internal/webhooks"
)

type workspaceAPIAction struct {
	Action          string `json:"action"`
	ID              string `json:"id"`
	Name            string `json:"name"`
	Label           string `json:"label"`
	URL             any    `json:"url"`
	Events          any    `json:"events"`
	Enabled         *bool  `json:"enabled"`
	PermissionLevel string `json:"permissionLevel"`
	Description     string `json:"description"`
	RedirectURL     any    `json:"redirectUrl"`
	RedirectURLs    any    `json:"redirectUrls"`
	Scopes          any    `json:"scopes"`
}

func (h Handler) GetCurrentAPI(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Get workspace API settings failed", err.Error())
		return
	}
	api, err := h.workspaceAPIPayload(r, p, settings)
	if err != nil {
		problem.Write(w, 500, "Get workspace API settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"api": api})
}

func (h Handler) UpdateCurrentAPISettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	var body workspaceAPIAction
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	if !isPermissionLevelValue(body.PermissionLevel) {
		problem.Write(w, 400, "A valid permission level is required.", "")
		return
	}
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update workspace API settings failed", err.Error())
		return
	}
	security := recordFromAny(settings["security"])
	permissions := recordFromAny(security["permissions"])
	permissions["apiKeyCreationRole"] = body.PermissionLevel
	security["permissions"] = permissions
	settings["security"] = security
	if err := h.saveWorkspaceSettingsKey(r.Context(), p.WorkspaceID, "security", settings["security"]); err != nil {
		problem.Write(w, 500, "Update workspace API settings failed", err.Error())
		return
	}
	api, _ := h.workspaceAPIPayload(r, p, settings)
	problem.JSON(w, 200, map[string]any{"api": api})
}

func (h Handler) MutateCurrentAPI(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update workspace API failed", err.Error())
		return
	}
	var body workspaceAPIAction
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	var credential map[string]any
	switch body.Action {
	case "createApiKey":
		if !canAPIKeyRole(p.Role, apiKeyPermission(settings)) {
			problem.Write(w, 403, "You do not have permission to create API keys.", "")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			problem.Write(w, 400, "API key name is required.", "")
			return
		}
		secret := "lin_api_" + randomHexString(24)
		hash := sha256.Sum256([]byte(secret))
		_, err := h.DB.Exec(r.Context(), `insert into api_key (name,key_hash,key_prefix,user_id,workspace_id) values ($1,$2,$3,$4,$5::uuid)`, name, hex.EncodeToString(hash[:]), secret[:12]+"…", p.UserID, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Create API key failed", err.Error())
			return
		}
		credential = map[string]any{"kind": "apiKey", "label": name + " API key", "secret": secret}
	case "deleteApiKey":
		id := strings.TrimSpace(body.ID)
		if id == "" {
			problem.Write(w, 400, "API key id is required.", "")
			return
		}
		ct, err := h.DB.Exec(r.Context(), `delete from api_key where id=$1::uuid and workspace_id=$2::uuid`, id, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Delete API key failed", err.Error())
			return
		}
		if ct.RowsAffected() == 0 {
			problem.Write(w, 404, "API key not found.", "")
			return
		}
	case "createWebhook":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		url := strings.TrimSpace(asStringValue(body.URL))
		if err := validateWebhookURL(url); err != nil {
			problem.JSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		events := apiEvents(body.Events)
		if len(events) == 0 {
			problem.Write(w, 400, "At least one webhook event is required.", "")
			return
		}
		for _, e := range events {
			if !webhookspkg.ValidEventType(e) {
				problem.Write(w, 400, "Unknown webhook event type: "+e, "")
				return
			}
		}
		secret := "whsec_" + randomHexString(24)
		var webhookID string
		err := h.DB.QueryRow(r.Context(), `insert into webhook (url,label,workspace_id,secret,enabled,events) values ($1,$2,$3::uuid,$4,true,$5) returning id::text`, url, nullString(strings.TrimSpace(body.Label)), p.WorkspaceID, secret, events).Scan(&webhookID)
		if err != nil {
			problem.Write(w, 500, "Create webhook failed", err.Error())
			return
		}
		credential = map[string]any{"kind": "webhook", "id": webhookID, "label": strings.TrimSpace(body.Label), "secret": secret}
	case "updateWebhook":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		if body.ID == "" || body.Enabled == nil {
			problem.Write(w, 400, "Webhook id and enabled state are required.", "")
			return
		}
		ct, err := h.DB.Exec(r.Context(), `update webhook set enabled=$1, updated_at=now() where id=$2::uuid and workspace_id=$3::uuid`, *body.Enabled, body.ID, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Update webhook failed", err.Error())
			return
		}
		if ct.RowsAffected() == 0 {
			problem.Write(w, 404, "Webhook not found.", "")
			return
		}
	case "deleteWebhook":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		ct, err := h.DB.Exec(r.Context(), `delete from webhook where id=$1::uuid and workspace_id=$2::uuid`, body.ID, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Delete webhook failed", err.Error())
			return
		}
		if ct.RowsAffected() == 0 {
			problem.Write(w, 404, "Webhook not found.", "")
			return
		}
	case "createOAuthApplication", "updateOAuthApplication", "rotateOAuthApplicationSecret", "deleteOAuthApplication":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		var err error
		settings, credential, err = mutateOAuthSettings(settings, p.UserID, body)
		if err != nil {
			problem.Write(w, 400, err.Error(), "")
			return
		}
		if err := h.saveWorkspaceSettingsKey(r.Context(), p.WorkspaceID, "api", settings["api"]); err != nil {
			problem.Write(w, 500, "Update OAuth applications failed", err.Error())
			return
		}
	case "createAirbyteToken":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			problem.Write(w, 400, "Airbyte token name is required.", "")
			return
		}
		secret := "pat_" + randomHexString(24)
		hash := sha256.Sum256([]byte(secret))
		scopes, _ := json.Marshal([]string{"read"})
		_, err := h.DB.Exec(r.Context(), `insert into personal_access_token (name, token_hash, token_prefix, user_id, workspace_id, scopes) values ($1,$2,$3,$4,$5::uuid,$6::jsonb)`, name, hex.EncodeToString(hash[:]), secret[:20], p.UserID, p.WorkspaceID, scopes)
		if err != nil {
			problem.Write(w, 500, "Create Airbyte token failed", err.Error())
			return
		}
		credential = map[string]any{"kind": "airbyteToken", "label": name + " Airbyte token", "secret": secret}
	case "deleteAirbyteToken":
		if !isManager(p.Role) {
			problem.Write(w, 403, "Forbidden", "")
			return
		}
		id := strings.TrimSpace(body.ID)
		if id == "" {
			problem.Write(w, 400, "Airbyte token id is required.", "")
			return
		}
		ct, err := h.DB.Exec(r.Context(), `update personal_access_token set revoked_at=coalesce(revoked_at, now()) where id=$1::uuid and workspace_id=$2::uuid and scopes='["read"]'::jsonb`, id, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Revoke Airbyte token failed", err.Error())
			return
		}
		if ct.RowsAffected() == 0 {
			problem.Write(w, 404, "Airbyte token not found.", "")
			return
		}
	default:
		problem.Write(w, 400, "Unsupported action.", "")
		return
	}
	api, _ := h.workspaceAPIPayload(r, p, settings)
	out := map[string]any{"api": api}
	if credential != nil {
		out["createdCredential"] = credential
	}
	problem.JSON(w, 200, out)
}

func (h Handler) workspaceAPIPayload(r *http.Request, p auth.Principal, settings map[string]any) (map[string]any, error) {
	permission := apiKeyPermission(settings)
	webhooks, err := h.workspaceWebhooks(r, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	keys, err := h.workspaceAPIKeys(r, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	airbyteTokens, err := h.workspaceAirbyteTokens(r, p.WorkspaceID)
	if err != nil {
		return nil, err
	}

	mcpAuditLog := []map[string]any{}
	if isManager(p.Role) {
		mcpAuditLog, err = h.workspaceMCPAuditLog(r, p.WorkspaceID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"permissionLevel": permission, "viewerRole": p.Role, "canManageWorkspaceApi": isManager(p.Role), "canCreateApiKeys": canAPIKeyRole(p.Role, permission), "docs": map[string]string{"graphql": "/docs/graphql", "oauthApplications": "/docs/oauth-applications", "webhooks": "/docs/webhooks", "airbyte": "/docs/airbyte"}, "oauthApplications": readOAuthApplications(settings), "webhooks": webhooks, "apiKeys": keys, "airbyteTokens": airbyteTokens, "supportedWebhookEvents": webhookspkg.KnownEventTypes, "mcpAuditLog": mcpAuditLog}, nil
}

func (h Handler) workspaceAirbyteTokens(r *http.Request, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select pat.id::text, pat.name, pat.token_prefix, pat.scopes, pat.created_at, pat.last_used_at, u.name, u.email, u.image from personal_access_token pat join "user" u on u.id=pat.user_id where pat.workspace_id=$1::uuid and pat.revoked_at is null and pat.scopes='["read"]'::jsonb order by pat.created_at desc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, prefix, creatorName, creatorEmail string
		var creatorImage *string
		var scopesRaw []byte
		var scopes []string
		var created time.Time
		var last *time.Time
		if err := rows.Scan(&id, &name, &prefix, &scopesRaw, &created, &last, &creatorName, &creatorEmail, &creatorImage); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(scopesRaw, &scopes)
		if scopes == nil {
			scopes = []string{"read"}
		}
		var lastAt any = nil
		if last != nil {
			lastAt = last.UTC().Format(time.RFC3339Nano)
		}
		out = append(out, map[string]any{"id": id, "name": name, "keyPrefix": prefix + "…", "scopes": scopes, "createdAt": created.UTC().Format(time.RFC3339Nano), "lastUsedAt": lastAt, "creator": map[string]any{"name": creatorName, "email": creatorEmail, "image": creatorImage}})
	}
	return out, rows.Err()
}

func (h Handler) workspaceWebhooks(r *http.Request, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,coalesce(label,''),url,coalesce(enabled,true),coalesce(events,'[]'::jsonb),created_at,updated_at from webhook where workspace_id=$1::uuid order by created_at desc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, label, url string
		var enabled bool
		var raw []byte
		var created, updated time.Time
		if err := rows.Scan(&id, &label, &url, &enabled, &raw, &created, &updated); err != nil {
			return nil, err
		}
		var events []string
		_ = json.Unmarshal(raw, &events)
		out = append(out, map[string]any{"id": id, "label": label, "url": url, "events": events, "enabled": enabled, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)})
	}
	return out, rows.Err()
}
func (h Handler) workspaceAPIKeys(r *http.Request, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select ak.id::text,ak.name,ak.key_prefix,ak.created_at,ak.last_used_at,u.name,u.email,u.image from api_key ak join "user" u on u.id=ak.user_id where ak.workspace_id=$1::uuid order by ak.created_at desc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, prefix, creatorName, creatorEmail string
		var creatorImage *string
		var created time.Time
		var last *time.Time
		if err := rows.Scan(&id, &name, &prefix, &created, &last, &creatorName, &creatorEmail, &creatorImage); err != nil {
			return nil, err
		}
		var lastAt any = nil
		if last != nil {
			lastAt = last.UTC().Format(time.RFC3339Nano)
		}
		out = append(out, map[string]any{"id": id, "name": name, "keyPrefix": prefix, "accessLevel": "Member", "createdAt": created.UTC().Format(time.RFC3339Nano), "lastUsedAt": lastAt, "creator": map[string]any{"name": creatorName, "email": creatorEmail, "image": creatorImage}})
	}
	return out, rows.Err()
}

func (h Handler) workspaceMCPAuditLog(r *http.Request, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text, token_id::text, metadata, created_at from personal_access_token_audit_log where workspace_id=$1::uuid and action='mcp_tool_call' order by created_at desc limit 100`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id string
		var tokenID *string
		var raw []byte
		var created time.Time
		if err := rows.Scan(&id, &tokenID, &raw, &created); err != nil {
			return nil, err
		}
		metadata := map[string]any{}
		_ = json.Unmarshal(raw, &metadata)
		toolName, _ := metadata["toolName"].(string)
		errorText, _ := metadata["error"].(string)
		out = append(out, map[string]any{"id": id, "toolName": toolName, "credentialId": tokenID, "success": metadata["success"] == true, "error": nullString(errorText), "createdAt": created.UTC().Format(time.RFC3339Nano)})
	}
	return out, rows.Err()
}

func apiKeyPermission(settings map[string]any) string {
	sec := recordFromAny(settings["security"])
	perms := recordFromAny(sec["permissions"])
	v := asStringValue(perms["apiKeyCreationRole"])
	if isPermissionLevelValue(v) {
		return v
	}
	return "admins"
}
func isPermissionLevelValue(v string) bool { return v == "admins" || v == "members" || v == "anyone" }
func canAPIKeyRole(role, permission string) bool {
	if role == "owner" || role == "admin" {
		return true
	}
	return permission == "anyone" || (permission == "members" && role == "member")
}
func apiEvents(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, e := range arr {
		if s := strings.TrimSpace(asStringValue(e)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func validateWebhookURL(value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("Webhook URL must be a valid absolute URL.")
	}
	if parsed.Scheme != "https" {
		return errors.New("Webhook URL must use HTTPS.")
	}
	host := strings.ToLower(parsed.Hostname())
	privateHost := host == "localhost" ||
		host == "127.0.0.1" ||
		strings.HasPrefix(host, "10.") ||
		strings.HasPrefix(host, "192.168.") ||
		strings.HasPrefix(host, "169.254.") ||
		strings.HasPrefix(host, "172.16.") ||
		strings.HasPrefix(host, "172.17.") ||
		strings.HasPrefix(host, "172.18.") ||
		strings.HasPrefix(host, "172.19.") ||
		strings.HasPrefix(host, "172.2") ||
		strings.HasPrefix(host, "172.30.") ||
		strings.HasPrefix(host, "172.31.")
	if privateHost {
		return errors.New("Webhook URL must not use localhost, loopback, private, or link-local hosts.")
	}
	return nil
}

func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
func randomHexString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func readOAuthApplications(settings map[string]any) []map[string]any {
	api := recordFromAny(settings["api"])
	raw, ok := api["oauthApplications"].([]any)
	if !ok {
		return []map[string]any{}
	}
	out := []map[string]any{}
	for _, item := range raw {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}
func writeOAuthApplications(settings map[string]any, apps []map[string]any) map[string]any {
	api := recordFromAny(settings["api"])
	values := []any{}
	for _, app := range apps {
		values = append(values, app)
	}
	api["oauthApplications"] = values
	settings["api"] = api
	return settings
}
func mutateOAuthSettings(settings map[string]any, userID string, body workspaceAPIAction) (map[string]any, map[string]any, error) {
	apps := readOAuthApplications(settings)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch body.Action {
	case "createOAuthApplication":
		name := strings.TrimSpace(body.Name)
		if name == "" {
			return settings, nil, errString("Application name is required.")
		}
		redirects, err := validatedOAuthRedirects(body)
		if err != nil {
			return settings, nil, err
		}
		scopes, err := validatedOAuthScopes(body.Scopes)
		if err != nil {
			return settings, nil, err
		}
		secret := "linsec_" + randomHexString(24)
		app := map[string]any{"id": "oauth_" + randomHexString(8), "name": name, "description": strings.TrimSpace(body.Description), "clientId": "lin_" + randomHexString(12), "clientSecretPreview": secret[:12] + "…", "clientSecretHash": hashString(secret), "redirectUrl": redirects[0], "redirectUrls": redirects, "scopes": scopes, "createdByUserId": userID, "createdAt": now, "updatedAt": now}
		apps = append([]map[string]any{app}, apps...)
		return writeOAuthApplications(settings, apps), map[string]any{"kind": "oauthApplication", "label": name + " client secret", "secret": secret}, nil
	case "updateOAuthApplication":
		redirects, err := validatedOAuthRedirects(body)
		if err != nil {
			return settings, nil, err
		}
		scopes, err := validatedOAuthScopes(body.Scopes)
		if err != nil {
			return settings, nil, err
		}
		for _, app := range apps {
			if app["id"] == body.ID {
				app["name"] = strings.TrimSpace(body.Name)
				app["description"] = strings.TrimSpace(body.Description)
				app["redirectUrl"] = redirects[0]
				app["redirectUrls"] = redirects
				app["scopes"] = scopes
				app["updatedAt"] = now
				return writeOAuthApplications(settings, apps), nil, nil
			}
		}
		return settings, nil, errString("OAuth application not found.")
	case "rotateOAuthApplicationSecret":
		secret := "linsec_" + randomHexString(24)
		for _, app := range apps {
			if app["id"] == body.ID {
				app["clientSecretPreview"] = secret[:12] + "…"
				app["clientSecretHash"] = hashString(secret)
				app["updatedAt"] = now
				return writeOAuthApplications(settings, apps), map[string]any{"kind": "oauthApplication", "label": asStringValue(app["name"]) + " client secret", "secret": secret}, nil
			}
		}
		return settings, nil, errString("OAuth application not found.")
	case "deleteOAuthApplication":
		next := []map[string]any{}
		found := false
		for _, app := range apps {
			if app["id"] == body.ID {
				found = true
				continue
			}
			next = append(next, app)
		}
		if !found {
			return settings, nil, errString("OAuth application not found.")
		}
		return writeOAuthApplications(settings, next), nil, nil
	}
	return settings, nil, nil
}
func hashString(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func firstRedirect(body workspaceAPIAction) string {
	list := redirectList(body)
	if len(list) > 0 {
		return list[0]
	}
	return ""
}
func redirectList(body workspaceAPIAction) []string {
	if arr, ok := body.RedirectURLs.([]any); ok {
		out := []string{}
		for _, v := range arr {
			if s := strings.TrimSpace(asStringValue(v)); s != "" {
				out = append(out, s)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if s := strings.TrimSpace(asStringValue(body.RedirectURL)); s != "" {
		return []string{s}
	}
	return []string{}
}
func scopeList(v any) []string {
	out := apiEvents(v)
	if len(out) == 0 {
		return []string{"read"}
	}
	return out
}

func validatedOAuthRedirects(body workspaceAPIAction) ([]string, error) {
	redirects := redirectList(body)
	if len(redirects) == 0 {
		return nil, errString("At least one redirect URL is required.")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, redirect := range redirects {
		if err := validateWebhookURL(redirect); err != nil {
			return nil, errString(strings.Replace(err.Error(), "Webhook URL", "Redirect URL", 1))
		}
		if !seen[redirect] {
			seen[redirect] = true
			out = append(out, redirect)
		}
	}
	return out, nil
}

var allowedOAuthScopes = map[string]bool{"read": true, "write": true, "issues:read": true, "issues:write": true, "comments:write": true, "projects:read": true, "projects:write": true, "attachments:write": true, "webhooks:write": true}

func validatedOAuthScopes(v any) ([]string, error) {
	scopes := scopeList(v)
	out := []string{}
	seen := map[string]bool{}
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if !allowedOAuthScopes[scope] {
			return nil, errString("OAuth scope is not supported.")
		}
		if !seen[scope] {
			seen[scope] = true
			out = append(out, scope)
		}
	}
	if len(out) == 0 {
		return []string{"read"}, nil
	}
	return out, nil
}

type errString string

func (e errString) Error() string { return string(e) }
