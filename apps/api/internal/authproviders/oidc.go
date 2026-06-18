package authproviders

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"golang.org/x/oauth2"
)

const (
	oidcRequestTTL    = 10 * time.Minute
	oidcRequestPrefix = "oidc-request:"
)

type oidcWorkspace struct {
	ID       string
	Settings oidcWorkspaceSettings
}

type oidcWorkspaceSettings struct {
	Enabled      bool
	IssuerURL    string
	ClientID     string
	ClientSecret string
	Domains      []string
}

type oidcDiscoveryRequest struct {
	Email       string `json:"email"`
	CallbackURL string `json:"callbackURL"`
}

type oidcRequestState struct {
	Nonce        string `json:"nonce"`
	CodeVerifier string `json:"codeVerifier"`
}

type oidcIDTokenClaims struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified *bool  `json:"email_verified"`
	Name          string `json:"name"`
	Nonce         string `json:"nonce"`
}

func (h Handler) OIDCDiscovery(w http.ResponseWriter, r *http.Request) {
	var input oidcDiscoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must be valid JSON."})
		return
	}
	domain := extractEmailDomain(input.Email)
	if domain == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Enter a valid email address."})
		return
	}
	discoveredURL, err := h.oidcDiscoveryRedirect(r.Context(), r, domain, input.CallbackURL)
	if err != nil {
		if errors.Is(err, errOIDCDuplicateDomain) {
			problem.JSON(w, http.StatusConflict, map[string]string{"error": "Multiple OIDC SSO workspaces match that email domain."})
			return
		}
		problem.Write(w, http.StatusInternalServerError, "Discover OIDC URL failed", err.Error())
		return
	}
	if discoveredURL == "" {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "No OIDC SSO enabled workspace could be found."})
		return
	}
	problem.JSON(w, http.StatusOK, map[string]string{"url": discoveredURL})
}

func (h Handler) oidcDiscoveryRedirect(ctx context.Context, r *http.Request, domain, callbackURL string) (string, error) {
	workspace, err := h.findOIDCWorkspace(ctx, domain)
	if err != nil {
		return "", err
	}
	if workspace.ID == "" {
		return "", nil
	}
	provider, err := oidc.NewProvider(ctx, workspace.Settings.IssuerURL)
	if err != nil {
		return "", err
	}
	codeVerifier := randomBase64URLAuth(32)
	state := "oidc_" + randomBase64URLAuth(18)
	nonce := randomBase64URLAuth(24)
	value, _ := json.Marshal(oidcRequestState{Nonce: nonce, CodeVerifier: codeVerifier})
	identifier := oidcRequestPrefix + workspace.ID + ":" + safeSAMLCallbackPath(r, callbackURL)
	_, err = h.DB.Exec(ctx, `insert into verification (id,identifier,value,expires_at,created_at,updated_at) values ($1,$2,$3,$4,now(),now())`, state, identifier, string(value), time.Now().UTC().Add(oidcRequestTTL))
	if err != nil {
		return "", err
	}
	cfg := oidcOAuthConfig(r, workspace.Settings, provider)
	return cfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("code_challenge", pkceS256Challenge(codeVerifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.SetAuthURLParam("nonce", nonce),
	), nil
}

func (h Handler) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	if message := strings.TrimSpace(r.URL.Query().Get("error")); message != "" {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": message})
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if state == "" || code == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Missing OIDC authorization code or state."})
		return
	}
	workspaceID, callbackURL, requestState, err := h.consumeOIDCRequest(r.Context(), state)
	if err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "OIDC request expired or already used."})
		return
	}
	workspace, err := h.oidcWorkspaceByID(r.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "OIDC workspace is not configured."})
			return
		}
		problem.Write(w, http.StatusInternalServerError, "OIDC callback failed", err.Error())
		return
	}
	if !workspace.Settings.Enabled {
		problem.JSON(w, http.StatusForbidden, map[string]string{"error": "OIDC SSO is disabled for this workspace."})
		return
	}
	provider, err := oidc.NewProvider(r.Context(), workspace.Settings.IssuerURL)
	if err != nil {
		problem.Write(w, http.StatusBadGateway, "OIDC discovery failed", err.Error())
		return
	}
	cfg := oidcOAuthConfig(r, workspace.Settings, provider)
	token, err := cfg.Exchange(r.Context(), code, oauth2.SetAuthURLParam("code_verifier", requestState.CodeVerifier))
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "OIDC token exchange failed", err.Error())
		return
	}
	rawIDToken, _ := token.Extra("id_token").(string)
	if rawIDToken == "" {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "OIDC provider did not return an ID token."})
		return
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: workspace.Settings.ClientID}).Verify(r.Context(), rawIDToken)
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "OIDC ID token verification failed", err.Error())
		return
	}
	var claims oidcIDTokenClaims
	if err := idToken.Claims(&claims); err != nil {
		problem.Write(w, http.StatusUnauthorized, "OIDC ID token claims failed", err.Error())
		return
	}
	if err := validateOIDCClaims(claims, requestState.Nonce, workspace.Settings.Domains); err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	user, err := h.upsertEmailUser(r.Context(), strings.ToLower(strings.TrimSpace(claims.Email)), claims.Name)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create OIDC user failed", err.Error())
		return
	}
	if err := h.linkOIDCAccount(r.Context(), workspace, claims, token, rawIDToken, user.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link OIDC account failed", err.Error())
		return
	}
	if err := h.attachSAMLWorkspaceMember(r.Context(), workspace.ID, user.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Attach OIDC workspace member failed", err.Error())
		return
	}
	sessionToken, expires, err := h.createBrowserSession(r, user.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create user session failed", err.Error())
		return
	}
	setSessionCookie(w, r, sessionToken, expires)
	http.Redirect(w, r, postAuthCompletionURL(r, callbackURL), http.StatusFound)
}

var errOIDCDuplicateDomain = errors.New("multiple OIDC workspaces match domain")

func (h Handler) findOIDCWorkspace(ctx context.Context, domain string) (oidcWorkspace, error) {
	rows, err := h.DB.Query(ctx, `select id::text,coalesce(settings,'{}'::jsonb) from workspace`)
	if err != nil {
		return oidcWorkspace{}, err
	}
	defer rows.Close()
	var found oidcWorkspace
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return oidcWorkspace{}, err
		}
		settings := readOIDCWorkspaceSettings(raw)
		if !settings.Enabled || !containsString(settings.Domains, domain) {
			continue
		}
		if found.ID != "" {
			return oidcWorkspace{}, fmt.Errorf("%w: %q", errOIDCDuplicateDomain, domain)
		}
		found = oidcWorkspace{ID: id, Settings: settings}
	}
	return found, rows.Err()
}

func (h Handler) oidcWorkspaceByID(ctx context.Context, workspaceID string) (oidcWorkspace, error) {
	var raw []byte
	var id string
	if err := h.DB.QueryRow(ctx, `select id::text,coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid limit 1`, workspaceID).Scan(&id, &raw); err != nil {
		return oidcWorkspace{}, err
	}
	return oidcWorkspace{ID: id, Settings: readOIDCWorkspaceSettings(raw)}, nil
}

func (h Handler) consumeOIDCRequest(ctx context.Context, state string) (string, string, oidcRequestState, error) {
	var identifier, rawValue string
	err := h.DB.QueryRow(ctx, `delete from verification where id=$1 and expires_at > now() returning identifier,value`, state).Scan(&identifier, &rawValue)
	if err != nil {
		return "", "", oidcRequestState{}, err
	}
	if !strings.HasPrefix(identifier, oidcRequestPrefix) {
		return "", "", oidcRequestState{}, fmt.Errorf("invalid OIDC request identifier")
	}
	parts := strings.SplitN(strings.TrimPrefix(identifier, oidcRequestPrefix), ":", 2)
	var requestState oidcRequestState
	if len(parts) != 2 || parts[0] == "" || json.Unmarshal([]byte(rawValue), &requestState) != nil || requestState.Nonce == "" || requestState.CodeVerifier == "" {
		return "", "", oidcRequestState{}, fmt.Errorf("invalid OIDC request identifier")
	}
	return parts[0], safeCallbackPath(parts[1]), requestState, nil
}

func validateOIDCClaims(claims oidcIDTokenClaims, expectedNonce string, domains []string) error {
	if strings.TrimSpace(claims.Subject) == "" {
		return fmt.Errorf("OIDC ID token did not include a subject.")
	}
	if strings.TrimSpace(claims.Nonce) == "" ||
		subtle.ConstantTimeCompare([]byte(strings.TrimSpace(claims.Nonce)), []byte(expectedNonce)) != 1 {
		return fmt.Errorf("OIDC nonce did not match the sign-in request.")
	}
	if claims.EmailVerified != nil && !*claims.EmailVerified {
		return fmt.Errorf("OIDC account email is not verified.")
	}
	emailAddr := strings.ToLower(strings.TrimSpace(claims.Email))
	domain := extractEmailDomain(emailAddr)
	if emailAddr == "" || domain == "" {
		return fmt.Errorf("OIDC ID token did not include a valid email address.")
	}
	if !containsString(domains, domain) {
		return fmt.Errorf("OIDC email domain is not enabled for this workspace.")
	}
	return nil
}

func (h Handler) linkOIDCAccount(ctx context.Context, workspace oidcWorkspace, claims oidcIDTokenClaims, token *oauth2.Token, rawIDToken, userID string) error {
	accountID := "oidc:" + hashOAuthSecret(workspace.Settings.IssuerURL+"|"+claims.Subject)
	refreshToken, _ := token.Extra("refresh_token").(string)
	_, err := h.DB.Exec(ctx, `insert into account (id,account_id,provider_id,user_id,access_token,refresh_token,id_token,access_token_expires_at,scope,created_at,updated_at) values ($1,$2,'oidc',$3,$4,$5,$6,$7,$8,now(),now()) on conflict (id) do update set user_id=excluded.user_id, access_token=excluded.access_token, refresh_token=coalesce(nullif(excluded.refresh_token,''), account.refresh_token), id_token=excluded.id_token, access_token_expires_at=excluded.access_token_expires_at, scope=excluded.scope, updated_at=now()`, accountID, claims.Subject, userID, token.AccessToken, refreshToken, rawIDToken, token.Expiry, "openid email profile")
	return err
}

func oidcOAuthConfig(r *http.Request, settings oidcWorkspaceSettings, provider *oidc.Provider) *oauth2.Config {
	return &oauth2.Config{ClientID: settings.ClientID, ClientSecret: settings.ClientSecret, Endpoint: provider.Endpoint(), RedirectURL: appURL(r) + "/api/auth/oidc/callback", Scopes: []string{oidc.ScopeOpenID, "email", "profile"}}
}

func readOIDCWorkspaceSettings(raw []byte) oidcWorkspaceSettings {
	root := map[string]any{}
	_ = json.Unmarshal(raw, &root)
	security := asRecordAny(root["security"])
	oidcRecord := asRecordAny(firstNonNilAuth(security["oidc"], root["oidc"]))
	return oidcWorkspaceSettings{
		Enabled:      boolValueDefault(oidcRecord["enabled"], false),
		IssuerURL:    strings.TrimRight(firstStringAuth(oidcRecord["issuerUrl"], oidcRecord["issuerURL"], oidcRecord["issuer"]), "/"),
		ClientID:     firstStringAuth(oidcRecord["clientId"], oidcRecord["clientID"]),
		ClientSecret: firstStringAuth(oidcRecord["clientSecret"]),
		Domains:      normalizeSAMLDiscoveryDomains(firstNonNilAuth(oidcRecord["domains"], oidcRecord["emailDomains"], oidcRecord["allowedDomains"])),
	}
}

func (s oidcWorkspaceSettings) configured() bool {
	return s.IssuerURL != "" && s.ClientID != "" && s.ClientSecret != "" && len(s.Domains) > 0
}
