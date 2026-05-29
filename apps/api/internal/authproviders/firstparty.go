package authproviders

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/email"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// pkceS256Challenge derives the S256 code_challenge from a code_verifier
// per RFC 7636 §4.2.
func pkceS256Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// sessionTokenHashAuth returns the hex-encoded SHA-256 hash of rawToken.
// This is the value stored in the session.token_hash column (Fix 5).
func sessionTokenHashAuth(rawToken string) string {
	sum := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(sum[:])
}

const authStateCookieName = "exponential_auth_state"

type googleClaims struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

func (h Handler) StartGoogle(w http.ResponseWriter, r *http.Request) {
	cfg, err := googleOAuthConfig(r)
	if err != nil {
		problem.JSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	callbackURL := safeCallbackPath(r.URL.Query().Get("callback_url"))
	// Generate PKCE code_verifier (RFC 7636 §4.1: 43-128 unreserved chars).
	// 32 random bytes → 43-char base64url string, well within the allowed range.
	codeVerifier := randomBase64URLAuth(32)
	codeChallenge := pkceS256Challenge(codeVerifier)
	// Encode verifier into the signed state so the callback can retrieve it
	// without a server-side store: stateRaw = nonce|callbackURL|codeVerifier
	stateRaw := randomBase64URLAuth(24) + "|" + callbackURL + "|" + codeVerifier
	state := signAuthValue(stateRaw)
	setTransientCookie(w, r, authStateCookieName, state, 10*time.Minute)
	http.Redirect(w, r, cfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	), http.StatusFound)
}

func (h Handler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	stateCookie, err := r.Cookie(authStateCookieName)
	if err != nil {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Missing OAuth state."})
		return
	}
	stateRaw, ok := verifyAuthValue(r.URL.Query().Get("state"))
	if !ok || !hmac.Equal([]byte(r.URL.Query().Get("state")), []byte(stateCookie.Value)) {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid OAuth state."})
		return
	}
	// stateRaw format: nonce|callbackURL|codeVerifier (3 parts since PKCE was added)
	// Older states without a verifier (2 parts) are rejected to enforce PKCE.
	parts := strings.SplitN(stateRaw, "|", 3)
	if len(parts) != 3 || parts[2] == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid OAuth state (missing PKCE verifier)."})
		return
	}
	callbackURL := safeCallbackPath(parts[1])
	codeVerifier := parts[2]
	cfg, err := googleOAuthConfig(r)
	if err != nil {
		problem.JSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	token, err := cfg.Exchange(r.Context(), r.URL.Query().Get("code"),
		oauth2.SetAuthURLParam("code_verifier", codeVerifier),
	)
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "Google OAuth exchange failed", err.Error())
		return
	}
	rawIDToken, _ := token.Extra("id_token").(string)
	if rawIDToken == "" {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Google did not return an ID token."})
		return
	}
	provider, err := oidc.NewProvider(r.Context(), "https://accounts.google.com")
	if err != nil {
		problem.Write(w, http.StatusBadGateway, "Google OIDC discovery failed", err.Error())
		return
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}).Verify(r.Context(), rawIDToken)
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "Google ID token verification failed", err.Error())
		return
	}
	var claims googleClaims
	if err := idToken.Claims(&claims); err != nil {
		problem.Write(w, http.StatusUnauthorized, "Google ID token claims failed", err.Error())
		return
	}
	if strings.TrimSpace(claims.Email) == "" || !claims.EmailVerified {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Google account email is not verified."})
		return
	}
	user, err := h.upsertOAuthUser(r.Context(), claims, token, rawIDToken)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create user session failed", err.Error())
		return
	}
	sessionToken, expires, err := h.createBrowserSession(r, user.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create user session failed", err.Error())
		return
	}
	setSessionCookie(w, r, sessionToken, expires)
	clearCookie(w, authStateCookieName)
	http.Redirect(w, r, postAuthCompletionURL(r, callbackURL), http.StatusFound)
}

func (h Handler) StartMagicLink(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email       string `json:"email"`
		CallbackURL string `json:"callbackURL"`
	}
	_ = json.NewDecoder(r.Body).Decode(&input)
	address := strings.ToLower(strings.TrimSpace(input.Email))
	if address == "" || !strings.Contains(address, "@") {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Enter a valid email address."})
		return
	}
	callbackURL := safeCallbackPath(input.CallbackURL)
	rawToken := randomBase64URLAuth(32)
	hash := sha256.Sum256([]byte(rawToken))
	verificationID := "magic_" + randomBase64URLAuth(12)
	_, err := h.DB.Exec(r.Context(), `insert into verification (id,identifier,value,expires_at,created_at,updated_at) values ($1,$2,$3,$4,now(),now())`, verificationID, "magic-link:"+address+":"+callbackURL, hex.EncodeToString(hash[:]), time.Now().UTC().Add(15*time.Minute))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create magic link failed", err.Error())
		return
	}
	link := appURL(r) + "/api/auth/magic-link/callback?token=" + url.QueryEscape(rawToken) + "&id=" + url.QueryEscape(verificationID)
	production := os.Getenv("NODE_ENV") == "production"

	// Non-production exposes the link in the response so local/dev/e2e can
	// exercise the flow without an inbox. Production never leaks the link
	// and instead relies on the configured email sender.
	if !production {
		problem.JSON(w, http.StatusAccepted, map[string]any{"ok": true, "url": link})
		return
	}

	if h.Email == nil || !h.Email.Enabled() {
		problem.JSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Magic link sign-in is not configured on this server.",
		})
		return
	}

	if err := h.Email.Send(r.Context(), magicLinkMessage(address, link)); err != nil {
		problem.Write(w, http.StatusBadGateway, "Send magic link failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func magicLinkMessage(to, link string) email.Message {
	html := `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">` +
		`<h2 style="color:#ffffff;font-size:20px;margin-bottom:24px">Sign in to exponential</h2>` +
		`<p style="color:#9ca3af;font-size:14px;margin-bottom:24px">Click the link below to sign in. This link expires in 15 minutes.</p>` +
		`<a href="` + link + `" style="display:inline-block;background:#7180ff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:500">Sign in</a>` +
		`<p style="color:#6b7280;font-size:12px;margin-top:32px">If you didn't request this email you can safely ignore it.</p>` +
		`</div>`
	text := "Sign in to exponential: " + link + "\n\nThis link expires in 15 minutes."
	return email.Message{To: to, Subject: "Sign in to exponential", HTML: html, Text: text}
}

func (h Handler) MagicLinkCallback(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if id == "" || token == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid magic link."})
		return
	}
	hash := sha256.Sum256([]byte(token))
	var identifier string
	err := h.DB.QueryRow(r.Context(), `delete from verification where id=$1 and value=$2 and expires_at > now() returning identifier`, id, hex.EncodeToString(hash[:])).Scan(&identifier)
	if err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Magic link expired or already used."})
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(identifier, "magic-link:"), ":", 2)
	if len(parts) != 2 {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid magic link."})
		return
	}
	email, callbackURL := parts[0], safeCallbackPath(parts[1])
	user, err := h.upsertEmailUser(r.Context(), email, "")
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create user session failed", err.Error())
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

func (h Handler) SignOut(w http.ResponseWriter, r *http.Request) {
	for _, value := range auth.BrowserSessionCookieValues(r) {
		if rawToken, ok := auth.VerifySignedSessionToken(value); ok {
			_, _ = h.DB.Exec(r.Context(), `delete from session where token_hash=$1`, sessionTokenHashAuth(rawToken))
		}
	}
	clearSessionCookie(w, r)
	problem.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type authUser struct{ ID string }

func (h Handler) upsertOAuthUser(ctx context.Context, claims googleClaims, token *oauth2.Token, rawIDToken string) (authUser, error) {
	name := strings.TrimSpace(claims.Name)
	if name == "" {
		name = strings.Split(claims.Email, "@")[0]
	}
	var image *string
	if strings.TrimSpace(claims.Picture) != "" {
		picture := strings.TrimSpace(claims.Picture)
		image = &picture
	}
	user, err := h.upsertEmailUser(ctx, claims.Email, name)
	if err != nil {
		return user, err
	}
	_, _ = h.DB.Exec(ctx, `update "user" set image=coalesce($2,image), email_verified=true, updated_at=now() where id=$1`, user.ID, image)
	accountID := "google:" + claims.Subject
	accessToken := token.AccessToken
	refreshToken, _ := token.Extra("refresh_token").(string)
	_, err = h.DB.Exec(ctx, `insert into account (id,account_id,provider_id,user_id,access_token,refresh_token,id_token,access_token_expires_at,scope,created_at,updated_at) values ($1,$2,'google',$3,$4,$5,$6,$7,$8,now(),now()) on conflict (id) do update set user_id=excluded.user_id, access_token=excluded.access_token, refresh_token=coalesce(nullif(excluded.refresh_token,''), account.refresh_token), id_token=excluded.id_token, access_token_expires_at=excluded.access_token_expires_at, scope=excluded.scope, updated_at=now()`, accountID, claims.Subject, user.ID, accessToken, refreshToken, rawIDToken, token.Expiry, "openid email profile")
	return user, err
}

func (h Handler) upsertEmailUser(ctx context.Context, email, name string) (authUser, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	id := "usr_" + randomBase64URLAuth(18)
	var user authUser
	err := h.DB.QueryRow(ctx, `insert into "user" (id,email,name,email_verified,created_at,updated_at) values ($1,$2,$3,true,now(),now()) on conflict (email) do update set name=coalesce(nullif(excluded.name,''), "user".name), email_verified=true, updated_at=now() returning id`, id, strings.ToLower(email), name).Scan(&user.ID)
	return user, err
}

func (h Handler) createBrowserSession(r *http.Request, userID string) (string, time.Time, error) {
	rawToken := randomBase64URLAuth(32)
	tokenHash := sessionTokenHashAuth(rawToken)
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	_, err := h.DB.Exec(r.Context(), `insert into session (id,expires_at,token_hash,created_at,updated_at,ip_address,user_agent,user_id) values ($1,$2,$3,now(),now(),$4,$5,$6)`, "sess_"+randomBase64URLAuth(18), expires, tokenHash, clientIPAuth(r), r.UserAgent(), userID)
	if err != nil {
		return "", time.Time{}, err
	}
	return auth.SignSessionToken(rawToken), expires, nil
}

func googleOAuthConfig(r *http.Request) (*oauth2.Config, error) {
	clientID := strings.TrimSpace(os.Getenv("AUTH_GOOGLE_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("AUTH_GOOGLE_SECRET"))
	if clientID == "" || clientSecret == "" {
		return nil, fmt.Errorf("Google OAuth is not configured")
	}
	return &oauth2.Config{ClientID: clientID, ClientSecret: clientSecret, Endpoint: google.Endpoint, RedirectURL: appURL(r) + "/api/auth/google/callback", Scopes: []string{oidc.ScopeOpenID, "email", "profile"}}, nil
}

func appURL(r *http.Request) string {
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/"); value != "" {
		return value
	}
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL")), "/"); value != "" {
		return value
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func postAuthCompletionURL(r *http.Request, callbackURL string) string {
	completion, err := url.Parse(appURL(r) + "/auth/complete")
	if err != nil {
		return safeCallbackPath(callbackURL)
	}
	query := completion.Query()
	query.Set("callbackUrl", safeCallbackPath(callbackURL))
	completion.RawQuery = query.Encode()
	return completion.String()
}

func safeCallbackPath(value string) string {
	if strings.TrimSpace(value) == "" {
		return "/"
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "/"
	}
	if parsed.IsAbs() {
		return "/"
	}
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/"
	}
	return value
}

func signAuthValue(raw string) string {
	mac := hmac.New(sha256.New, []byte(auth.DevSessionSecret()))
	mac.Write([]byte(raw))
	return raw + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyAuthValue(value string) (string, bool) {
	raw, sig, ok := strings.Cut(strings.TrimSpace(value), ".")
	if !ok || raw == "" || sig == "" {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(auth.DevSessionSecret()))
	mac.Write([]byte(raw))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", false
	}
	return raw, true
}

func randomBase64URLAuth(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func setTransientCookie(w http.ResponseWriter, r *http.Request, name, value string, age time.Duration) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Expires: time.Now().Add(age), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secureCookie(r)})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, value string, expires time.Time) {
	clearSessionCookie(w, r)
	http.SetCookie(w, &http.Cookie{Name: auth.BrowserSessionCookieName, Value: value, Path: "/", Expires: expires, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secureCookie(r)})
}

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	clearCookie(w, auth.BrowserSessionCookieName)
	for _, domain := range cookieDomainCleanupCandidates(r) {
		http.SetCookie(w, &http.Cookie{Name: auth.BrowserSessionCookieName, Value: "", Path: "/", Domain: domain, MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secureCookie(r)})
	}
}

func cookieDomainCleanupCandidates(r *http.Request) []string {
	parsed, err := url.Parse(appURL(r))
	if err != nil {
		return nil
	}
	host := strings.ToLower(strings.Trim(parsed.Hostname(), "."))
	if host == "" || host == "localhost" || net.ParseIP(host) != nil {
		return nil
	}
	candidates := []string{host}
	parts := strings.Split(host, ".")
	if len(parts) > 2 {
		parent := strings.Join(parts[len(parts)-2:], ".")
		if parent != host {
			candidates = append(candidates, parent)
		}
	}
	return candidates
}

func secureCookie(r *http.Request) bool {
	for _, key := range []string{"PUBLIC_BASE_URL", "NEXT_PUBLIC_APP_URL", "EXPONENTIAL_APP_URL"} {
		value := strings.TrimSpace(os.Getenv(key))
		if value == "" {
			continue
		}
		parsed, err := url.Parse(value)
		if err == nil && strings.EqualFold(parsed.Scheme, "https") {
			return true
		}
	}
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func clientIPAuth(r *http.Request) string {
	if value := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); value != "" {
		return value
	}
	return strings.TrimSpace(r.RemoteAddr)
}
