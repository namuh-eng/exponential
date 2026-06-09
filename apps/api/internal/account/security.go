package account

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type securityAction struct {
	Action        string `json:"action"`
	SessionID     string `json:"sessionId"`
	PasskeyID     string `json:"passkeyId"`
	ApplicationID string `json:"applicationId"`
	APIKeyID      string `json:"apiKeyId"`
	Name          string `json:"name"`
}

func (h Handler) GetSecurity(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	payload, err := h.securityPayload(r, p.UserID, p.WorkspaceID, "")
	if err != nil {
		problem.Write(w, 500, "Get security failed", err.Error())
		return
	}
	problem.JSON(w, 200, payload)
}

func (h Handler) UpdateSecurity(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var body securityAction
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	switch body.Action {
	case "revokeSession":
		if strings.TrimSpace(body.SessionID) == "" {
			problem.Write(w, 400, "Session id is required.", "")
			return
		}
		_, _ = h.DB.Exec(r.Context(), `delete from session where id=$1 and user_id=$2`, body.SessionID, p.UserID)
	case "revokeAllOtherSessions":
		if tokenHash := currentBrowserSessionTokenHash(r); tokenHash != "" {
			_, _ = h.DB.Exec(r.Context(), `delete from session where user_id=$1 and token_hash<>$2`, p.UserID, tokenHash)
		} else {
			_, _ = h.DB.Exec(r.Context(), `delete from session where user_id=$1`, p.UserID)
		}
	case "revokePasskey":
		if body.PasskeyID == "" {
			problem.Write(w, 400, "Passkey id is required.", "")
			return
		}
		_, _ = h.DB.Exec(r.Context(), `delete from passkey where id=$1 and user_id=$2`, body.PasskeyID, p.UserID)
	case "createApiKey":
		name := strings.TrimSpace(body.Name)
		if name == "" {
			problem.Write(w, 400, "API key name is required.", "")
			return
		}
		if len(name) > 255 {
			problem.Write(w, 400, "API key name must be 255 characters or fewer.", "")
			return
		}
		secret := randomSecret()
		hash := sha256.Sum256([]byte(secret))
		_, err := h.DB.Exec(r.Context(), `insert into api_key (name,key_hash,key_prefix,user_id,workspace_id) values ($1,$2,$3,$4,$5::uuid)`, name, hex.EncodeToString(hash[:]), secret[:12]+"…", p.UserID, p.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Create API key failed", err.Error())
			return
		}
		payload, err := h.securityPayload(r, p.UserID, p.WorkspaceID, secret)
		if err != nil {
			problem.Write(w, 500, "Get security failed", err.Error())
			return
		}
		problem.JSON(w, 200, payload)
		return
	case "revokeApiKey":
		if body.APIKeyID == "" {
			problem.Write(w, 400, "API key id is required.", "")
			return
		}
		_, _ = h.DB.Exec(r.Context(), `delete from api_key where id=$1::uuid and user_id=$2 and workspace_id=$3::uuid`, body.APIKeyID, p.UserID, p.WorkspaceID)
	case "revokeAuthorizedApplication":
		if body.ApplicationID == "" {
			problem.Write(w, 400, "Authorized application id is required.", "")
			return
		}
		_, _ = h.DB.Exec(r.Context(), `delete from authorized_application_grant where id=$1 and user_id=$2`, body.ApplicationID, p.UserID)
	default:
		problem.Write(w, 400, "Unsupported action.", "")
		return
	}
	payload, err := h.securityPayload(r, p.UserID, p.WorkspaceID, "")
	if err != nil {
		problem.Write(w, 500, "Get security failed", err.Error())
		return
	}
	problem.JSON(w, 200, payload)
}

func (h Handler) securityPayload(r *http.Request, userID, workspaceID, createdSecret string) (map[string]any, error) {
	sessions := []map[string]any{}
	currentTokenHash := currentBrowserSessionTokenHash(r)
	rows, err := h.DB.Query(r.Context(), `select id,token_hash,user_agent,ip_address,created_at,updated_at,expires_at from session where user_id=$1 and expires_at>now() order by updated_at desc limit 10`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, tokenHash string
		var ua, ip *string
		var c, u, e time.Time
		if err := rows.Scan(&id, &tokenHash, &ua, &ip, &c, &u, &e); err != nil {
			return nil, err
		}
		sessions = append(sessions, map[string]any{"id": id, "isCurrent": currentTokenHash != "" && tokenHash == currentTokenHash, "userAgent": ua, "ipAddress": ip, "source": "Browser", "location": "Unknown location", "createdAt": c.UTC().Format(time.RFC3339Nano), "updatedAt": u.UTC().Format(time.RFC3339Nano), "expiresAt": e.UTC().Format(time.RFC3339Nano)})
	}
	passkeys := []map[string]any{}
	pk, _ := h.DB.Query(r.Context(), `select id,coalesce(name,'Unnamed passkey'),credential_id,coalesce(device_type,''),backed_up,coalesce(transports,''),created_at from passkey where user_id=$1 order by created_at desc`, userID)
	if pk != nil {
		defer pk.Close()
		for pk.Next() {
			var id, name, cred, dev, trans string
			var backed bool
			var c time.Time
			if err := pk.Scan(&id, &name, &cred, &dev, &backed, &trans, &c); err == nil {
				passkeys = append(passkeys, map[string]any{"id": id, "name": name, "credentialId": cred, "deviceType": dev, "backedUp": backed, "transports": strings.Split(trans, ","), "createdAt": c.UTC().Format(time.RFC3339Nano)})
			}
		}
	}
	apps := []map[string]any{}
	ar, _ := h.DB.Query(r.Context(), `select id,app_id,client_id,name,image_url,scopes,webhooks_enabled,created_at,updated_at from authorized_application_grant where user_id=$1 order by updated_at desc`, userID)
	if ar != nil {
		defer ar.Close()
		for ar.Next() {
			var id, app, client, name string
			var img *string
			var scopesRaw []byte
			var wh bool
			var c, u time.Time
			if err := ar.Scan(&id, &app, &client, &name, &img, &scopesRaw, &wh, &c, &u); err == nil {
				var scopes any = []any{}
				_ = json.Unmarshal(scopesRaw, &scopes)
				apps = append(apps, map[string]any{"id": id, "appId": app, "clientId": client, "name": name, "imageUrl": img, "publisher": nil, "scopes": scopes, "permissionGroups": []any{}, "webhooksEnabled": wh, "createdAt": c.UTC().Format(time.RFC3339Nano), "updatedAt": u.UTC().Format(time.RFC3339Nano), "lastUsedAt": nil})
			}
		}
	}
	keys := []map[string]any{}
	kr, _ := h.DB.Query(r.Context(), `select ak.id::text,ak.name,ak.key_prefix,w.name,ak.created_at,ak.last_used_at from api_key ak join workspace w on w.id=ak.workspace_id where ak.user_id=$1 and ak.workspace_id=$2::uuid order by ak.created_at desc`, userID, workspaceID)
	if kr != nil {
		defer kr.Close()
		for kr.Next() {
			var id, name, prefix, workspace string
			var c time.Time
			var last *time.Time
			if err := kr.Scan(&id, &name, &prefix, &workspace, &c, &last); err == nil {
				var lastS any = nil
				if last != nil {
					lastS = last.UTC().Format(time.RFC3339Nano)
				}
				keys = append(keys, map[string]any{"id": id, "name": name, "keyPrefix": prefix, "workspaceName": workspace, "accessLevel": "Member", "createdAt": c.UTC().Format(time.RFC3339Nano), "lastUsedAt": lastS})
			}
		}
	}
	out := map[string]any{"sessions": sessions, "passkeys": passkeys, "authorizedApplications": apps, "apiKeys": keys, "canCreateApiKeys": true, "providers": []any{}, "passkeyEnabled": true}
	if createdSecret != "" {
		out["createdCredential"] = map[string]any{"kind": "apiKey", "label": "API key", "secret": createdSecret}
	}
	return out, nil
}

func currentBrowserSessionTokenHash(r *http.Request) string {
	for _, name := range []string{auth.BrowserSessionCookieName, "session_token"} {
		cookie, err := r.Cookie(name)
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			continue
		}
		if token, ok := auth.VerifySignedSessionToken(cookie.Value); ok {
			sum := sha256.Sum256([]byte(token))
			return hex.EncodeToString(sum[:])
		}
	}
	return ""
}

func randomSecret() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "lin_api_" + hex.EncodeToString(b)
}
