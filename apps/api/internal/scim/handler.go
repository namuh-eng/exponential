package scim

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	userSchema         = "urn:ietf:params:scim:schemas:core:2.0:User"
	groupSchema        = "urn:ietf:params:scim:schemas:core:2.0:Group"
	listResponseSchema = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
	errorSchema        = "urn:ietf:params:scim:api:messages:2.0:Error"
)

type Handler struct{ DB *pgxpool.Pool }

type contextKey string

const workspaceKey contextKey = "scimWorkspaceID"

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(h.requireToken)
	r.Get("/Users", h.ListUsers)
	r.Post("/Users", h.CreateUser)
	r.Get("/Users/{id}", h.GetUser)
	r.Put("/Users/{id}", h.ReplaceUser)
	r.Patch("/Users/{id}", h.PatchUser)
	r.Delete("/Users/{id}", h.DeleteUser)
	r.Get("/Groups", h.ListGroups)
	r.Post("/Groups", h.CreateGroup)
	r.Get("/Groups/{id}", h.GetGroup)
	r.Put("/Groups/{id}", h.ReplaceGroup)
	r.Patch("/Groups/{id}", h.PatchGroup)
	r.Delete("/Groups/{id}", h.DeleteGroup)
	return r
}

func (h Handler) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			scimError(w, http.StatusUnauthorized, "Unauthorized", "")
			return
		}
		workspaceID, tokenID, err := h.authenticate(r.Context(), token)
		if err != nil {
			scimError(w, http.StatusUnauthorized, "Unauthorized", "")
			return
		}
		_, _ = h.DB.Exec(r.Context(), `update workspace_scim_token set last_used_at=now() where id=$1`, tokenID)
		nowJSON, _ := json.Marshal(time.Now().UTC().Format(time.RFC3339Nano))
		_, _ = h.DB.Exec(r.Context(), `update workspace set settings=jsonb_set(coalesce(settings,'{}'::jsonb), '{security,scim,lastSyncAt}', $1::jsonb, true) where id=$2::uuid`, nowJSON, workspaceID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), workspaceKey, workspaceID)))
	})
}

func (h Handler) authenticate(ctx context.Context, token string) (string, string, error) {
	var workspaceID, tokenID string
	err := h.DB.QueryRow(ctx, `
		select t.workspace_id::text, t.id
		from workspace_scim_token t
		join workspace w on w.id=t.workspace_id
		where t.token_hash=$1 and t.revoked_at is null and (w.settings #>> '{security,scim,enabled}') = 'true'
		limit 1`, hashSCIMToken(token)).Scan(&workspaceID, &tokenID)
	return workspaceID, tokenID, err
}

func workspaceID(ctx context.Context) string {
	id, _ := ctx.Value(workspaceKey).(string)
	return id
}

type userResource struct {
	Schemas     []string     `json:"schemas"`
	ID          string       `json:"id"`
	ExternalID  string       `json:"externalId,omitempty"`
	UserName    string       `json:"userName"`
	Name        nameResource `json:"name,omitempty"`
	DisplayName string       `json:"displayName,omitempty"`
	Emails      []emailValue `json:"emails"`
	Active      bool         `json:"active"`
	Meta        metaResource `json:"meta"`
}

type nameResource struct {
	GivenName  string `json:"givenName,omitempty"`
	FamilyName string `json:"familyName,omitempty"`
	Formatted  string `json:"formatted,omitempty"`
}

type emailValue struct {
	Value   string `json:"value"`
	Primary bool   `json:"primary"`
	Type    string `json:"type,omitempty"`
}

type metaResource struct {
	ResourceType string `json:"resourceType"`
	Created      string `json:"created,omitempty"`
	LastModified string `json:"lastModified,omitempty"`
}

type groupResource struct {
	Schemas     []string           `json:"schemas"`
	ID          string             `json:"id"`
	DisplayName string             `json:"displayName"`
	Members     []groupMemberValue `json:"members"`
	Meta        metaResource       `json:"meta"`
}

type groupMemberValue struct {
	Value   string `json:"value"`
	Display string `json:"display,omitempty"`
}

type listResponse struct {
	Schemas      []string `json:"schemas"`
	TotalResults int      `json:"totalResults"`
	StartIndex   int      `json:"startIndex"`
	ItemsPerPage int      `json:"itemsPerPage"`
	Resources    any      `json:"Resources"`
}

type userInput struct {
	ExternalID  string       `json:"externalId"`
	UserName    string       `json:"userName"`
	Name        nameResource `json:"name"`
	DisplayName string       `json:"displayName"`
	Emails      []emailValue `json:"emails"`
	Active      *bool        `json:"active"`
}

type patchRequest struct {
	Operations []patchOperation `json:"Operations"`
}

type patchOperation struct {
	Op    string `json:"op"`
	Path  string `json:"path"`
	Value any    `json:"value"`
}

type userFilter struct {
	userName string
	email    string
}

var (
	userNameFilterRE    = regexp.MustCompile(`(?i)^\s*userName\s+eq\s+"([^"]+)"\s*$`)
	emailValueFilterRE  = regexp.MustCompile(`(?i)^\s*emails\[\s*primary\s+eq\s+true\s*\]\.value\s+eq\s+"([^"]+)"\s*$`)
	emailAndPrimaryRE   = regexp.MustCompile(`(?i)^\s*emails\[\s*primary\s+eq\s+true\s+and\s+value\s+eq\s+"([^"]+)"\s*\]\s*$`)
	emailEqFilterRE     = regexp.MustCompile(`(?i)^\s*emails\s+eq\s+"([^"]+)"\s*$`)
	primaryOnlyFilterRE = regexp.MustCompile(`(?i)^\s*emails\[\s*primary\s+eq\s+true\s*\]\s*$`)
)

func parseUserFilter(raw string) (userFilter, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || primaryOnlyFilterRE.MatchString(raw) {
		return userFilter{}, nil
	}
	if match := userNameFilterRE.FindStringSubmatch(raw); match != nil {
		return userFilter{userName: normalizeEmail(match[1])}, nil
	}
	for _, re := range []*regexp.Regexp{emailValueFilterRE, emailAndPrimaryRE, emailEqFilterRE} {
		if match := re.FindStringSubmatch(raw); match != nil {
			return userFilter{email: normalizeEmail(match[1])}, nil
		}
	}
	return userFilter{}, fmt.Errorf("unsupported SCIM filter")
}

func (h Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	filter, err := parseUserFilter(r.URL.Query().Get("filter"))
	if err != nil {
		scimErrorType(w, http.StatusBadRequest, "invalidFilter", err.Error())
		return
	}
	users, err := h.users(r.Context(), workspaceID(r.Context()), filter)
	if err != nil {
		scimError(w, http.StatusInternalServerError, "List users failed", err.Error())
		return
	}
	start, count := pagination(r)
	paged := paginateUsers(users, start, count)
	scimJSON(w, http.StatusOK, listResponse{Schemas: []string{listResponseSchema}, TotalResults: len(users), StartIndex: start, ItemsPerPage: len(paged), Resources: paged})
}

func (h Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	user, err := h.userByID(r.Context(), workspaceID(r.Context()), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		scimError(w, http.StatusNotFound, "User not found", "")
		return
	}
	if err != nil {
		scimError(w, http.StatusInternalServerError, "Get user failed", err.Error())
		return
	}
	scimJSON(w, http.StatusOK, user)
}

func (h Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var input userInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	user, err := h.upsertUser(r.Context(), workspaceID(r.Context()), input)
	if err != nil {
		writeProvisioningError(w, err, "Create user failed")
		return
	}
	scimJSON(w, http.StatusCreated, user)
}

func (h Handler) ReplaceUser(w http.ResponseWriter, r *http.Request) {
	var input userInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	user, err := h.replaceUser(r.Context(), workspaceID(r.Context()), chi.URLParam(r, "id"), input)
	if err != nil {
		writeProvisioningError(w, err, "Replace user failed")
		return
	}
	scimJSON(w, http.StatusOK, user)
}

func (h Handler) PatchUser(w http.ResponseWriter, r *http.Request) {
	var input patchRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	for _, op := range input.Operations {
		if !strings.EqualFold(op.Op, "replace") {
			scimErrorType(w, http.StatusBadRequest, "mutability", "Only replace operations are supported for Users")
			return
		}
		if err := h.applyUserPatch(r.Context(), workspaceID(r.Context()), chi.URLParam(r, "id"), op); err != nil {
			writeProvisioningError(w, err, "Patch user failed")
			return
		}
	}
	user, err := h.userByID(r.Context(), workspaceID(r.Context()), chi.URLParam(r, "id"))
	if err != nil {
		writeProvisioningError(w, err, "Patch user failed")
		return
	}
	scimJSON(w, http.StatusOK, user)
}

func (h Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if err := h.setUserActive(r.Context(), workspaceID(r.Context()), chi.URLParam(r, "id"), false); err != nil {
		writeProvisioningError(w, err, "Delete user failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h Handler) users(ctx context.Context, workspaceID string, filter userFilter) ([]userResource, error) {
	where := "where m.workspace_id=$1::uuid"
	args := []any{workspaceID}
	if filter.userName != "" {
		args = append(args, filter.userName)
		where += fmt.Sprintf(" and lower(u.email)=lower($%d)", len(args))
	}
	if filter.email != "" {
		args = append(args, filter.email)
		where += fmt.Sprintf(" and lower(u.email)=lower($%d)", len(args))
	}
	rows, err := h.DB.Query(ctx, `select m.id::text, coalesce(m.scim_external_id,''), u.email, u.name, m.deleted_at is null, m.created_at, greatest(m.updated_at,u.updated_at) from member m join "user" u on u.id=m.user_id `+where+` order by u.email asc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []userResource{}
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (h Handler) userByID(ctx context.Context, workspaceID string, id string) (userResource, error) {
	row := h.DB.QueryRow(ctx, `select m.id::text, coalesce(m.scim_external_id,''), u.email, u.name, m.deleted_at is null, m.created_at, greatest(m.updated_at,u.updated_at) from member m join "user" u on u.id=m.user_id where m.workspace_id=$1::uuid and m.id=$2::uuid limit 1`, workspaceID, id)
	return scanUser(row)
}

type rowScanner interface{ Scan(dest ...any) error }

func scanUser(row rowScanner) (userResource, error) {
	var id, externalID, email, name string
	var active bool
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &externalID, &email, &name, &active, &createdAt, &updatedAt); err != nil {
		return userResource{}, err
	}
	return userResource{Schemas: []string{userSchema}, ID: id, ExternalID: externalID, UserName: email, DisplayName: name, Name: displayNameParts(name), Emails: []emailValue{{Value: email, Primary: true, Type: "work"}}, Active: active, Meta: metaResource{ResourceType: "User", Created: createdAt.UTC().Format(time.RFC3339Nano), LastModified: updatedAt.UTC().Format(time.RFC3339Nano)}}, nil
}

func (h Handler) upsertUser(ctx context.Context, workspaceID string, input userInput) (userResource, error) {
	email := inputEmail(input)
	if email == "" {
		return userResource{}, badRequest("userName or primary email is required")
	}
	if err := h.emailAllowed(ctx, workspaceID, email); err != nil {
		return userResource{}, err
	}
	active := true
	if input.Active != nil {
		active = *input.Active
	}
	name := displayName(input)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return userResource{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var userID string
	if err := tx.QueryRow(ctx, `insert into "user" (id,email,name,email_verified,created_at,updated_at) values ($1,$2,$3,true,now(),now()) on conflict (email) do update set name=coalesce(nullif(excluded.name,''), "user".name), email_verified=true, updated_at=now() returning id`, "usr_"+randomBase64URL(18), email, name).Scan(&userID); err != nil {
		return userResource{}, err
	}
	var memberID string
	deletedExpr := "null"
	if !active {
		deletedExpr = "now()"
	}
	if err := tx.QueryRow(ctx, `insert into member (user_id, workspace_id, role, scim_external_id, deleted_at, updated_at) values ($1,$2::uuid,'member',$3,`+deletedExpr+`,now()) on conflict (user_id, workspace_id) do update set scim_external_id=coalesce(nullif(excluded.scim_external_id,''), member.scim_external_id), deleted_at=case when member.role='owner' then member.deleted_at else excluded.deleted_at end, updated_at=now() returning id::text`, userID, workspaceID, strings.TrimSpace(input.ExternalID)).Scan(&memberID); err != nil {
		return userResource{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return userResource{}, err
	}
	return h.userByID(ctx, workspaceID, memberID)
}

func (h Handler) replaceUser(ctx context.Context, workspaceID string, id string, input userInput) (userResource, error) {
	current, err := h.userRole(ctx, workspaceID, id)
	if err != nil {
		return userResource{}, err
	}
	if input.Active != nil && !*input.Active && current == "owner" {
		return userResource{}, badRequest("Owners cannot be deprovisioned by SCIM")
	}
	email := inputEmail(input)
	if email != "" {
		if err := h.emailAllowed(ctx, workspaceID, email); err != nil {
			return userResource{}, err
		}
	}
	name := displayName(input)
	_, err = h.DB.Exec(ctx, `update "user" u set email=coalesce(nullif($3,''), u.email), name=coalesce(nullif($4,''), u.name), updated_at=now() from member m where m.user_id=u.id and m.workspace_id=$1::uuid and m.id=$2::uuid`, workspaceID, id, email, name)
	if err != nil {
		return userResource{}, err
	}
	if strings.TrimSpace(input.ExternalID) != "" {
		_, err = h.DB.Exec(ctx, `update member set scim_external_id=$3, updated_at=now() where workspace_id=$1::uuid and id=$2::uuid`, workspaceID, id, strings.TrimSpace(input.ExternalID))
		if err != nil {
			return userResource{}, err
		}
	}
	if input.Active != nil {
		if err := h.setUserActive(ctx, workspaceID, id, *input.Active); err != nil {
			return userResource{}, err
		}
	}
	return h.userByID(ctx, workspaceID, id)
}

func (h Handler) applyUserPatch(ctx context.Context, workspaceID string, id string, op patchOperation) error {
	path := strings.ToLower(strings.TrimSpace(op.Path))
	if path == "active" {
		active, ok := op.Value.(bool)
		if !ok {
			return badRequest("active must be a boolean")
		}
		return h.setUserActive(ctx, workspaceID, id, active)
	}
	if path == "" {
		value, ok := op.Value.(map[string]any)
		if !ok {
			return badRequest("replace value must be an object")
		}
		if raw, ok := value["active"]; ok {
			active, ok := raw.(bool)
			if !ok {
				return badRequest("active must be a boolean")
			}
			return h.setUserActive(ctx, workspaceID, id, active)
		}
	}
	return badRequest("Unsupported User PATCH path")
}

func (h Handler) setUserActive(ctx context.Context, workspaceID string, id string, active bool) error {
	role, err := h.userRole(ctx, workspaceID, id)
	if err != nil {
		return err
	}
	if role == "owner" && !active {
		return badRequest("Owners cannot be deprovisioned by SCIM")
	}
	deletedAt := "now()"
	if active {
		deletedAt = "null"
	}
	_, err = h.DB.Exec(ctx, `update member set deleted_at=`+deletedAt+`, updated_at=now() where workspace_id=$1::uuid and id=$2::uuid`, workspaceID, id)
	return err
}

func (h Handler) userRole(ctx context.Context, workspaceID string, id string) (string, error) {
	var role string
	err := h.DB.QueryRow(ctx, `select role::text from member where workspace_id=$1::uuid and id=$2::uuid limit 1`, workspaceID, id).Scan(&role)
	return role, err
}

func (h Handler) emailAllowed(ctx context.Context, workspaceID string, email string) error {
	domain := emailDomain(email)
	if domain == "" {
		return badRequest("A valid email domain is required")
	}
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(approved_email_domains,'[]'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return err
	}
	var domains []string
	_ = json.Unmarshal(raw, &domains)
	for _, approved := range domains {
		if strings.EqualFold(strings.TrimPrefix(strings.TrimSpace(approved), "@"), domain) {
			return nil
		}
	}
	return badRequest("Email domain is not approved for SCIM provisioning")
}

func (h Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.groups(r.Context(), workspaceID(r.Context()))
	if err != nil {
		scimError(w, http.StatusInternalServerError, "List groups failed", err.Error())
		return
	}
	start, count := pagination(r)
	paged := paginateGroups(groups, start, count)
	scimJSON(w, http.StatusOK, listResponse{Schemas: []string{listResponseSchema}, TotalResults: len(groups), StartIndex: start, ItemsPerPage: len(paged), Resources: paged})
}

func (h Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var input groupResource
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	role, err := normalizeRole(firstNonEmpty(input.DisplayName, input.ID))
	if err != nil {
		scimError(w, http.StatusBadRequest, err.Error(), "")
		return
	}
	if err := h.addGroupMembers(r.Context(), workspaceID(r.Context()), role, input.Members); err != nil {
		writeProvisioningError(w, err, "Create group failed")
		return
	}
	group, err := h.group(r.Context(), workspaceID(r.Context()), role)
	if err != nil {
		writeProvisioningError(w, err, "Create group failed")
		return
	}
	scimJSON(w, http.StatusCreated, group)
}

func (h Handler) GetGroup(w http.ResponseWriter, r *http.Request) {
	role, err := normalizeRole(chi.URLParam(r, "id"))
	if err != nil {
		scimError(w, http.StatusNotFound, "Group not found", "")
		return
	}
	group, err := h.group(r.Context(), workspaceID(r.Context()), role)
	if err != nil {
		writeProvisioningError(w, err, "Get group failed")
		return
	}
	scimJSON(w, http.StatusOK, group)
}

func (h Handler) ReplaceGroup(w http.ResponseWriter, r *http.Request) {
	role, err := normalizeRole(chi.URLParam(r, "id"))
	if err != nil {
		scimError(w, http.StatusNotFound, "Group not found", "")
		return
	}
	var input groupResource
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	if err := h.replaceGroupMembers(r.Context(), workspaceID(r.Context()), role, input.Members); err != nil {
		writeProvisioningError(w, err, "Replace group failed")
		return
	}
	group, err := h.group(r.Context(), workspaceID(r.Context()), role)
	if err != nil {
		writeProvisioningError(w, err, "Replace group failed")
		return
	}
	scimJSON(w, http.StatusOK, group)
}

func (h Handler) PatchGroup(w http.ResponseWriter, r *http.Request) {
	role, err := normalizeRole(chi.URLParam(r, "id"))
	if err != nil {
		scimError(w, http.StatusNotFound, "Group not found", "")
		return
	}
	var input patchRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		scimError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	for _, op := range input.Operations {
		members := patchMembers(op.Value)
		switch strings.ToLower(op.Op) {
		case "add", "replace":
			if err := h.addGroupMembers(r.Context(), workspaceID(r.Context()), role, members); err != nil {
				writeProvisioningError(w, err, "Patch group failed")
				return
			}
		case "remove":
			if err := h.removeGroupMembers(r.Context(), workspaceID(r.Context()), role, members); err != nil {
				writeProvisioningError(w, err, "Patch group failed")
				return
			}
		default:
			scimErrorType(w, http.StatusBadRequest, "mutability", "Unsupported group PATCH operation")
			return
		}
	}
	group, err := h.group(r.Context(), workspaceID(r.Context()), role)
	if err != nil {
		writeProvisioningError(w, err, "Patch group failed")
		return
	}
	scimJSON(w, http.StatusOK, group)
}

func (h Handler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	role, err := normalizeRole(chi.URLParam(r, "id"))
	if err != nil {
		scimError(w, http.StatusNotFound, "Group not found", "")
		return
	}
	if role == "member" {
		scimError(w, http.StatusBadRequest, "The member group cannot be deleted", "")
		return
	}
	_, err = h.DB.Exec(r.Context(), `update member set role='member', updated_at=now() where workspace_id=$1::uuid and role=$2::member_role and deleted_at is null`, workspaceID(r.Context()), role)
	if err != nil {
		scimError(w, http.StatusInternalServerError, "Delete group failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h Handler) groups(ctx context.Context, workspaceID string) ([]groupResource, error) {
	out := []groupResource{}
	for _, role := range []string{"admin", "member", "guest"} {
		group, err := h.group(ctx, workspaceID, role)
		if err != nil {
			return nil, err
		}
		out = append(out, group)
	}
	return out, nil
}

func (h Handler) group(ctx context.Context, workspaceID string, role string) (groupResource, error) {
	rows, err := h.DB.Query(ctx, `select m.id::text, coalesce(u.name,u.email) from member m join "user" u on u.id=m.user_id where m.workspace_id=$1::uuid and m.role=$2::member_role and m.deleted_at is null order by u.email`, workspaceID, role)
	if err != nil {
		return groupResource{}, err
	}
	defer rows.Close()
	members := []groupMemberValue{}
	for rows.Next() {
		var member groupMemberValue
		if err := rows.Scan(&member.Value, &member.Display); err != nil {
			return groupResource{}, err
		}
		members = append(members, member)
	}
	return groupResource{Schemas: []string{groupSchema}, ID: role, DisplayName: role, Members: members, Meta: metaResource{ResourceType: "Group"}}, rows.Err()
}

func (h Handler) replaceGroupMembers(ctx context.Context, workspaceID string, role string, members []groupMemberValue) error {
	if err := h.addGroupMembers(ctx, workspaceID, role, members); err != nil {
		return err
	}
	if role == "member" {
		return nil
	}
	ids := []string{}
	for _, member := range members {
		ids = append(ids, member.Value)
	}
	_, err := h.DB.Exec(ctx, `update member set role='member', updated_at=now() where workspace_id=$1::uuid and role=$2::member_role and deleted_at is null and not (id::text = any($3::text[]))`, workspaceID, role, ids)
	return err
}

func (h Handler) addGroupMembers(ctx context.Context, workspaceID string, role string, members []groupMemberValue) error {
	for _, member := range members {
		if strings.TrimSpace(member.Value) == "" {
			continue
		}
		if err := h.setMemberRole(ctx, workspaceID, member.Value, role); err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) removeGroupMembers(ctx context.Context, workspaceID string, role string, members []groupMemberValue) error {
	if role == "member" {
		return nil
	}
	for _, member := range members {
		if strings.TrimSpace(member.Value) == "" {
			continue
		}
		var changed string
		err := h.DB.QueryRow(ctx, `update member set role='member', updated_at=now() where workspace_id=$1::uuid and id=$2::uuid and role=$3::member_role and deleted_at is null and role <> 'owner' returning id::text`, workspaceID, member.Value, role).Scan(&changed)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) setMemberRole(ctx context.Context, workspaceID string, memberID string, role string) error {
	var changed string
	err := h.DB.QueryRow(ctx, `update member set role=$3::member_role, updated_at=now() where workspace_id=$1::uuid and id=$2::uuid and deleted_at is null and role <> 'owner' returning id::text`, workspaceID, memberID, role).Scan(&changed)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var owner bool
	ownerErr := h.DB.QueryRow(ctx, `select role='owner' from member where workspace_id=$1::uuid and id=$2::uuid limit 1`, workspaceID, memberID).Scan(&owner)
	if ownerErr == nil && owner {
		return badRequest("Owners cannot be managed by SCIM groups")
	}
	return pgx.ErrNoRows
}

func normalizeRole(value string) (string, error) {
	role := strings.ToLower(strings.TrimSpace(value))
	switch role {
	case "admin", "member", "guest":
		return role, nil
	default:
		return "", fmt.Errorf("Unsupported SCIM group role")
	}
}

func patchMembers(value any) []groupMemberValue {
	items, ok := value.([]any)
	if !ok {
		if record, ok := value.(map[string]any); ok {
			items, _ = record["members"].([]any)
		}
	}
	members := []groupMemberValue{}
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		members = append(members, groupMemberValue{Value: strings.TrimSpace(asString(record["value"])), Display: asString(record["display"])})
	}
	return members
}

func inputEmail(input userInput) string {
	for _, email := range input.Emails {
		if email.Primary && strings.TrimSpace(email.Value) != "" {
			return normalizeEmail(email.Value)
		}
	}
	for _, email := range input.Emails {
		if strings.TrimSpace(email.Value) != "" {
			return normalizeEmail(email.Value)
		}
	}
	return normalizeEmail(input.UserName)
}

func displayName(input userInput) string {
	if strings.TrimSpace(input.DisplayName) != "" {
		return strings.TrimSpace(input.DisplayName)
	}
	if strings.TrimSpace(input.Name.Formatted) != "" {
		return strings.TrimSpace(input.Name.Formatted)
	}
	return strings.TrimSpace(strings.TrimSpace(input.Name.GivenName) + " " + strings.TrimSpace(input.Name.FamilyName))
}

func displayNameParts(displayName string) nameResource {
	parts := strings.Fields(displayName)
	name := nameResource{Formatted: displayName}
	if len(parts) > 0 {
		name.GivenName = parts[0]
	}
	if len(parts) > 1 {
		name.FamilyName = strings.Join(parts[1:], " ")
	}
	return name
}

func pagination(r *http.Request) (int, int) {
	start := positiveQueryInt(r, "startIndex", 1)
	count := positiveQueryInt(r, "count", 100)
	return start, count
}

func positiveQueryInt(r *http.Request, name string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func paginateUsers(users []userResource, start int, count int) []userResource {
	idx := start - 1
	if idx >= len(users) {
		return []userResource{}
	}
	end := idx + count
	if end > len(users) {
		end = len(users)
	}
	return users[idx:end]
}

func paginateGroups(groups []groupResource, start int, count int) []groupResource {
	idx := start - 1
	if idx >= len(groups) {
		return []groupResource{}
	}
	end := idx + count
	if end > len(groups) {
		end = len(groups)
	}
	return groups[idx:end]
}

func bearerToken(r *http.Request) string {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

func hashSCIMToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func randomBase64URL(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func emailDomain(email string) string {
	parts := strings.Split(normalizeEmail(email), "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return parts[1]
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func asString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

type requestError struct{ detail string }

func (e requestError) Error() string { return e.detail }

func badRequest(detail string) error { return requestError{detail: detail} }

func writeProvisioningError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, pgx.ErrNoRows) {
		scimError(w, http.StatusNotFound, "Resource not found", "")
		return
	}
	var reqErr requestError
	if errors.As(err, &reqErr) {
		scimError(w, http.StatusBadRequest, reqErr.detail, "")
		return
	}
	scimError(w, http.StatusInternalServerError, fallback, err.Error())
}

func scimJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/scim+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func scimError(w http.ResponseWriter, status int, detail string, debug string) {
	scimErrorType(w, status, "", firstNonEmpty(detail, debug))
}

func scimErrorType(w http.ResponseWriter, status int, scimType string, detail string) {
	body := map[string]any{"schemas": []string{errorSchema}, "status": strconv.Itoa(status), "detail": detail}
	if scimType != "" {
		body["scimType"] = scimType
	}
	scimJSON(w, status, body)
}
