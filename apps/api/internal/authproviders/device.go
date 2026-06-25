package authproviders

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const (
	deviceCodeExpiresIn = 10 * time.Minute
	devicePollInterval  = 5 * time.Second
	deviceUserCodeMaxAttempts = 8
)

var numericUserCodePattern = regexp.MustCompile(`^\d{6}$`)

type deviceCodeResponse struct {
	DeviceCode     string `json:"device_code"`
	UserCode       string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval       int    `json:"interval"`
	ExpiresIn      int    `json:"expires_in"`
}

type deviceTokenRequest struct {
	DeviceCode string `json:"device_code"`
}

type deviceTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

type deviceGrantRequest struct {
	UserCode string `json:"user_code"`
	Action   string `json:"action"`
}

type deviceGrantResponse struct {
	UserCode  string `json:"user_code"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expires_at"`
}

func (h Handler) CreateDeviceCode(w http.ResponseWriter, r *http.Request) {
	deviceCode, err := newDeviceCode()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create device code failed", err.Error())
		return
	}
	userCode, err := h.reserveUserCode(r.Context())
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create device code failed", err.Error())
		return
	}
	expiresAt := time.Now().UTC().Add(deviceCodeExpiresIn)
	hash := sha256.Sum256([]byte(deviceCode))
	_, err = h.DB.Exec(r.Context(), `insert into device_auth_grant (device_code_hash,user_code,status,expires_at,interval_seconds,next_poll_at) values ($1,$2,'pending',$3,$4,now())`, hex.EncodeToString(hash[:]), userCode, expiresAt, int(devicePollInterval/time.Second))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create device code failed", err.Error())
		return
	}
	uri := appURL(r) + "/auth/device?user_code=" + userCode
	problem.JSON(w, http.StatusOK, deviceCodeResponse{DeviceCode: deviceCode, UserCode: userCode, VerificationURI: uri, Interval: int(devicePollInterval / time.Second), ExpiresIn: int(deviceCodeExpiresIn / time.Second)})
}

func (h Handler) PollDeviceToken(w http.ResponseWriter, r *http.Request) {
	var input deviceTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		deviceTokenError(w, http.StatusBadRequest, "invalid_request", 0)
		return
	}
	deviceCode := strings.TrimSpace(input.DeviceCode)
	if deviceCode == "" {
		deviceTokenError(w, http.StatusBadRequest, "invalid_request", 0)
		return
	}
	hash := sha256.Sum256([]byte(deviceCode))
	status, token, interval, err := h.pollDeviceGrant(r.Context(), hex.EncodeToString(hash[:]))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Poll device token failed", err.Error())
		return
	}
	switch status {
	case "approved":
		problem.JSON(w, http.StatusOK, deviceTokenResponse{AccessToken: token, TokenType: "Bearer", Scope: "cli"})
	case "slow_down":
		deviceTokenError(w, http.StatusPreconditionRequired, "slow_down", interval)
	case "pending":
		deviceTokenError(w, http.StatusPreconditionRequired, "authorization_pending", interval)
	case "denied":
		deviceTokenError(w, http.StatusForbidden, "access_denied", 0)
	case "expired":
		deviceTokenError(w, http.StatusBadRequest, "expired_token", 0)
	default:
		deviceTokenError(w, http.StatusBadRequest, "invalid_grant", 0)
	}
}

func (h Handler) GetDeviceGrant(w http.ResponseWriter, r *http.Request) {
	if _, _, err := (auth.Middleware{DB: h.DB}).BrowserSession(r.Context(), r); err != nil {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "browser session required")
		return
	}
	userCode := normalizeUserCode(r.URL.Query().Get("user_code"))
	if userCode == "" {
		problem.Write(w, http.StatusBadRequest, "Device code is required", "Enter the 6-digit code shown by the CLI.")
		return
	}
	grant, err := h.deviceGrantByUserCode(r.Context(), userCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			problem.Write(w, http.StatusNotFound, "Device code not found", "Request a new code from the CLI and try again.")
			return
		}
		problem.Write(w, http.StatusInternalServerError, "Get device code failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, grant)
}

func (h Handler) UpdateDeviceGrant(w http.ResponseWriter, r *http.Request) {
	_, principal, err := (auth.Middleware{DB: h.DB}).BrowserSession(r.Context(), r)
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "browser session required")
		return
	}
	var input deviceGrantRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	userCode := normalizeUserCode(input.UserCode)
	if userCode == "" {
		problem.Write(w, http.StatusBadRequest, "Device code is required", "Enter the 6-digit code shown by the CLI.")
		return
	}
	action := strings.TrimSpace(strings.ToLower(input.Action))
	if action != "approve" && action != "deny" {
		problem.Write(w, http.StatusBadRequest, "Unsupported device action", "Use approve or deny.")
		return
	}
	if action == "approve" && strings.TrimSpace(principal.WorkspaceID) == "" {
		problem.Write(w, http.StatusBadRequest, "Workspace required", "Select a workspace before approving CLI access.")
		return
	}
	status := "denied"
	if action == "approve" {
		status = "approved"
	}
	cmd, err := h.DB.Exec(r.Context(), `update device_auth_grant set status=$1, approved_user_id=nullif($2,''), approved_workspace_id=nullif($3,'')::uuid, decided_at=now(), updated_at=now() where user_code=$4 and status='pending' and expires_at>now()`, status, principal.UserID, principal.WorkspaceID, userCode)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update device code failed", err.Error())
		return
	}
	if cmd.RowsAffected() == 0 {
		problem.Write(w, http.StatusConflict, "Device code cannot be updated", "The code is expired, already used, denied, or unknown.")
		return
	}
	grant, err := h.deviceGrantByUserCode(r.Context(), userCode)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get device code failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, grant)
}

func (h Handler) reserveUserCode(ctx context.Context) (string, error) {
	for range deviceUserCodeMaxAttempts {
		code, err := newUserCode()
		if err != nil {
			return "", err
		}
		var exists bool
		err = h.DB.QueryRow(ctx, `select exists(select 1 from device_auth_grant where user_code=$1 and status='pending' and expires_at>now())`, code).Scan(&exists)
		if err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("could not allocate a unique user code")
}

func (h Handler) deviceGrantByUserCode(ctx context.Context, userCode string) (deviceGrantResponse, error) {
	var grant deviceGrantResponse
	var expiresAt time.Time
	err := h.DB.QueryRow(ctx, `select user_code, case when status='pending' and expires_at<=now() then 'expired' else status end, expires_at from device_auth_grant where user_code=$1`, userCode).Scan(&grant.UserCode, &grant.Status, &expiresAt)
	if err != nil {
		return deviceGrantResponse{}, err
	}
	grant.ExpiresAt = expiresAt.UTC().Format(time.RFC3339Nano)
	return grant, nil
}

func (h Handler) pollDeviceGrant(ctx context.Context, deviceCodeHash string) (string, string, int, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", "", 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id, status string
	var expiresAt, nextPollAt time.Time
	var intervalSeconds, slowDownCount int
	var userID, workspaceID *string
	var consumedAt *time.Time
	err = tx.QueryRow(ctx, `select id::text, status, expires_at, interval_seconds, next_poll_at, slow_down_count, approved_user_id, approved_workspace_id::text, consumed_at from device_auth_grant where device_code_hash=$1 for update`, deviceCodeHash).Scan(&id, &status, &expiresAt, &intervalSeconds, &nextPollAt, &slowDownCount, &userID, &workspaceID, &consumedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "invalid_grant", "", 0, nil
		}
		return "", "", 0, err
	}
	now := time.Now().UTC()
	if consumedAt != nil {
		return "invalid_grant", "", 0, tx.Commit(ctx)
	}
	if now.After(expiresAt) {
		_, err = tx.Exec(ctx, `update device_auth_grant set status='expired', updated_at=now() where id=$1::uuid and status='pending'`, id)
		if err != nil {
			return "", "", 0, err
		}
		return "expired", "", 0, tx.Commit(ctx)
	}
	if status == "denied" {
		return "denied", "", 0, tx.Commit(ctx)
	}
	if status == "pending" {
		if now.Before(nextPollAt) {
			slowDownCount++
			intervalSeconds += 5
			_, err = tx.Exec(ctx, `update device_auth_grant set interval_seconds=$1, slow_down_count=$2, next_poll_at=now()+($1 || ' seconds')::interval, updated_at=now() where id=$3::uuid`, intervalSeconds, slowDownCount, id)
			if err != nil {
				return "", "", 0, err
			}
			return "slow_down", "", intervalSeconds, tx.Commit(ctx)
		}
		_, err = tx.Exec(ctx, `update device_auth_grant set next_poll_at=now()+($1 || ' seconds')::interval, updated_at=now() where id=$2::uuid`, intervalSeconds, id)
		if err != nil {
			return "", "", 0, err
		}
		return "pending", "", intervalSeconds, tx.Commit(ctx)
	}
	if status != "approved" || userID == nil || workspaceID == nil {
		return "invalid_grant", "", 0, tx.Commit(ctx)
	}

	secret, err := newPATSecret()
	if err != nil {
		return "", "", 0, err
	}
	tokenHash := sha256.Sum256([]byte(secret))
	scopesJSON, _ := json.Marshal([]string{"cli"})
	var tokenID string
	err = tx.QueryRow(ctx, `insert into personal_access_token (name, token_hash, token_prefix, user_id, workspace_id, scopes) values ('Exponential CLI', $1, $2, $3, $4::uuid, $5::jsonb) returning id::text`, hex.EncodeToString(tokenHash[:]), secret[:min(len(secret), 20)], *userID, *workspaceID, scopesJSON).Scan(&tokenID)
	if err != nil {
		return "", "", 0, err
	}
	_, err = tx.Exec(ctx, `insert into personal_access_token_audit_log (token_id, user_id, workspace_id, action, metadata) values ($1::uuid,$2,$3::uuid,'created',$4::jsonb)`, tokenID, *userID, *workspaceID, []byte(`{"source":"device_code"}`))
	if err != nil {
		return "", "", 0, err
	}
	_, err = tx.Exec(ctx, `update device_auth_grant set token_id=$1::uuid, consumed_at=now(), updated_at=now() where id=$2::uuid`, tokenID, id)
	if err != nil {
		return "", "", 0, err
	}
	return "approved", secret, 0, tx.Commit(ctx)
}

func deviceTokenError(w http.ResponseWriter, status int, code string, interval int) {
	body := map[string]any{"error": code}
	if interval > 0 {
		body["interval"] = interval
	}
	problem.JSON(w, status, body)
}

func normalizeUserCode(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, "-", "")
	if !numericUserCodePattern.MatchString(value) {
		return ""
	}
	return value
}

func newUserCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func newDeviceCode() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func newPATSecret() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "pat_" + hex.EncodeToString(buf), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
