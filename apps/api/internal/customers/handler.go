package customers

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

type Customer struct {
	ID           string   `json:"id"`
	WorkspaceID  string   `json:"workspaceId"`
	Domain       *string  `json:"domain"`
	Name         string   `json:"name"`
	Revenue      *float64 `json:"revenue"`
	Size         *int32   `json:"size"`
	Tier         *string  `json:"tier"`
	Status       *string  `json:"status"`
	OwnerID      *string  `json:"ownerId"`
	Source       *string  `json:"source"`
	RequestCount int32    `json:"requestCount"`
	IssueCount   int32    `json:"issueCount"`
	ProjectCount int32    `json:"projectCount"`
	CreatedAt    string   `json:"createdAt"`
	UpdatedAt    string   `json:"updatedAt"`
}

type CustomerSummary struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Domain *string `json:"domain"`
	Tier   *string `json:"tier"`
	Status *string `json:"status"`
}

type CustomerRequest struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspaceId"`
	CustomerID       string          `json:"customerId"`
	Customer         CustomerSummary `json:"customer"`
	Title            string          `json:"title"`
	Body             *string         `json:"body"`
	Source           *string         `json:"source"`
	SourceURL        *string         `json:"sourceUrl"`
	ExternalProvider *string         `json:"externalProvider"`
	ExternalID       *string         `json:"externalId"`
	Important        bool            `json:"important"`
	CreatedByUserID  *string         `json:"createdByUserId"`
	LinkedIssues     []LinkedIssue   `json:"linkedIssues"`
	LinkedProjects   []LinkedProject `json:"linkedProjects"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
}

type LinkedIssue struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	TeamKey    string `json:"teamKey"`
}

type LinkedProject struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type customerInput struct {
	Name    string   `json:"name"`
	Domain  *string  `json:"domain"`
	Revenue *float64 `json:"revenue"`
	Size    *int32   `json:"size"`
	Tier    *string  `json:"tier"`
	Status  *string  `json:"status"`
	OwnerID *string  `json:"ownerId"`
	Source  *string  `json:"source"`
}

type customerPatch struct {
	Name    *string  `json:"name"`
	Domain  *string  `json:"domain"`
	Revenue *float64 `json:"revenue"`
	Size    *int32   `json:"size"`
	Tier    *string  `json:"tier"`
	Status  *string  `json:"status"`
	OwnerID *string  `json:"ownerId"`
	Source  *string  `json:"source"`
}

type requestInput struct {
	Title            string  `json:"title"`
	Body             *string `json:"body"`
	Source           *string `json:"source"`
	SourceURL        *string `json:"sourceUrl"`
	ExternalProvider *string `json:"externalProvider"`
	ExternalID       *string `json:"externalId"`
	Important        *bool   `json:"important"`
	IssueID          *string `json:"issueId"`
	ProjectID        *string `json:"projectId"`
}

type requestPatch struct {
	Title            *string `json:"title"`
	Body             *string `json:"body"`
	Source           *string `json:"source"`
	SourceURL        *string `json:"sourceUrl"`
	ExternalProvider *string `json:"externalProvider"`
	ExternalID       *string `json:"externalId"`
	Important        *bool   `json:"important"`
}

type linkInput struct {
	IssueID   string `json:"issueId"`
	ProjectID string `json:"projectId"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{customerID}", h.Get)
	r.Patch("/{customerID}", h.Update)
	r.Get("/{customerID}/requests.csv", h.ExportCustomer)
	r.Post("/{customerID}/requests", h.CreateRequest)
	return r
}

func (h Handler) RequestRoutes() chi.Router {
	r := chi.NewRouter()
	r.Patch("/{requestID}", h.UpdateRequest)
	r.Delete("/{requestID}", h.DeleteRequest)
	r.Post("/{requestID}/issues", h.LinkIssue)
	r.Delete("/{requestID}/issues/{issueID}", h.UnlinkIssue)
	r.Post("/{requestID}/projects", h.LinkProject)
	r.Delete("/{requestID}/projects/{projectID}", h.UnlinkProject)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	args := []any{p.WorkspaceID}
	where := "c.workspace_id=$1::uuid"
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+escapeLike(q)+"%")
		where += fmt.Sprintf(" and (c.name ilike $%d or c.domain ilike $%d)", len(args), len(args))
	}
	if tier := strings.TrimSpace(r.URL.Query().Get("tier")); tier != "" {
		args = append(args, tier)
		where += fmt.Sprintf(" and c.tier=$%d", len(args))
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" and c.status=$%d", len(args))
	}
	customers, err := h.listCustomers(r.Context(), where, args...)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "List customers failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"customers": customers})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	var input customerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		problem.Write(w, http.StatusBadRequest, "Customer name is required", "")
		return
	}
	customer, err := scanCustomer(h.DB.QueryRow(r.Context(), `
		insert into customer (workspace_id, domain, name, revenue, size, tier, status, owner_id, source, created_by_user_id)
		values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		returning `+customerColumns("")+`, 0::int, 0::int, 0::int`,
		p.WorkspaceID, cleanPtr(input.Domain), name, input.Revenue, input.Size, cleanPtr(input.Tier), cleanPtr(input.Status), cleanPtr(input.OwnerID), cleanPtr(input.Source), p.UserID))
	if isUniqueViolation(err) {
		problem.Write(w, http.StatusConflict, "Customer domain already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create customer failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusCreated, customer)
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	customer, err := h.getCustomer(r.Context(), p.WorkspaceID, chi.URLParam(r, "customerID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Customer not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get customer failed", err.Error())
		return
	}
	requests, err := h.requestsForCustomer(r.Context(), p.WorkspaceID, customer.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get customer failed", err.Error())
		return
	}
	issues, projects, err := h.relatedWork(r.Context(), p.WorkspaceID, customer.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get customer failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"customer": customer, "requests": requests, "issues": issues, "projects": projects})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	var input customerPatch
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	existing, err := h.getCustomer(r.Context(), p.WorkspaceID, chi.URLParam(r, "customerID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Customer not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update customer failed", err.Error())
		return
	}
	name := existing.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if name == "" {
		problem.Write(w, http.StatusBadRequest, "Customer name is required", "")
		return
	}
	customer, err := scanCustomer(h.DB.QueryRow(r.Context(), `
		update customer set
		  name=$3,
		  domain=coalesce($4::text, domain),
		  revenue=coalesce($5::numeric, revenue),
		  size=coalesce($6::integer, size),
		  tier=coalesce($7::text, tier),
		  status=coalesce($8::text, status),
		  owner_id=coalesce($9::text, owner_id),
		  source=coalesce($10::text, source),
		  updated_at=now()
		where workspace_id=$1::uuid and id=$2::uuid
		returning `+customerColumns("")+`,
		  (select count(*)::int from customer_request cr where cr.customer_id=customer.id),
		  (select count(distinct icr.issue_id)::int from customer_request cr join issue_customer_request icr on icr.customer_request_id=cr.id where cr.customer_id=customer.id),
		  (select count(distinct pcr.project_id)::int from customer_request cr join project_customer_request pcr on pcr.customer_request_id=cr.id where cr.customer_id=customer.id)`,
		p.WorkspaceID, existing.ID, name, cleanPtr(input.Domain), input.Revenue, input.Size, cleanPtr(input.Tier), cleanPtr(input.Status), cleanPtr(input.OwnerID), cleanPtr(input.Source)))
	if isUniqueViolation(err) {
		problem.Write(w, http.StatusConflict, "Customer domain already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update customer failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, customer)
}

func (h Handler) CreateRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	customer, err := h.getCustomer(r.Context(), p.WorkspaceID, chi.URLParam(r, "customerID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Customer not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create request failed", err.Error())
		return
	}
	var input requestInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		problem.Write(w, http.StatusBadRequest, "Request title is required", "")
		return
	}
	important := false
	if input.Important != nil {
		important = *input.Important
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create request failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	request, err := scanRequest(tx.QueryRow(r.Context(), `
		insert into customer_request (workspace_id, customer_id, title, body, source, source_url, external_provider, external_id, important, created_by_user_id)
		values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10)
		returning `+requestColumns(""), p.WorkspaceID, customer.ID, title, cleanPtr(input.Body), cleanPtr(input.Source), cleanPtr(input.SourceURL), cleanPtr(input.ExternalProvider), cleanPtr(input.ExternalID), important, p.UserID))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create request failed", err.Error())
		return
	}
	request.Customer = customerSummary(customer)
	if input.IssueID != nil && strings.TrimSpace(*input.IssueID) != "" {
		issueID, err := resolveIssueID(r.Context(), tx, p.WorkspaceID, *input.IssueID)
		if err != nil {
			problem.Write(w, http.StatusBadRequest, "Issue not found", err.Error())
			return
		}
		if err := linkIssue(r.Context(), tx, issueID, request.ID, p.UserID); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Link issue failed", err.Error())
			return
		}
	}
	if input.ProjectID != nil && strings.TrimSpace(*input.ProjectID) != "" {
		projectID, err := resolveProjectID(r.Context(), tx, p.WorkspaceID, *input.ProjectID)
		if err != nil {
			problem.Write(w, http.StatusBadRequest, "Project not found", err.Error())
			return
		}
		if err := linkProject(r.Context(), tx, projectID, request.ID, p.UserID); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Link project failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create request failed", err.Error())
		return
	}
	full, err := h.getRequest(r.Context(), p.WorkspaceID, request.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create request failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusCreated, full)
}

func (h Handler) UpdateRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	var input requestPatch
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	existing, err := h.getRequest(r.Context(), p.WorkspaceID, chi.URLParam(r, "requestID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Request not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update request failed", err.Error())
		return
	}
	title := existing.Title
	if input.Title != nil {
		title = strings.TrimSpace(*input.Title)
	}
	if title == "" {
		problem.Write(w, http.StatusBadRequest, "Request title is required", "")
		return
	}
	important := existing.Important
	if input.Important != nil {
		important = *input.Important
	}
	_, err = h.DB.Exec(r.Context(), `
		update customer_request set title=$3, body=coalesce($4, body), source=coalesce($5, source), source_url=coalesce($6, source_url), external_provider=coalesce($7, external_provider), external_id=coalesce($8, external_id), important=$9, updated_at=now()
		where workspace_id=$1::uuid and id=$2::uuid`, p.WorkspaceID, existing.ID, title, cleanPtr(input.Body), cleanPtr(input.Source), cleanPtr(input.SourceURL), cleanPtr(input.ExternalProvider), cleanPtr(input.ExternalID), important)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update request failed", err.Error())
		return
	}
	request, err := h.getRequest(r.Context(), p.WorkspaceID, existing.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update request failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, request)
}

func (h Handler) DeleteRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	command, err := h.DB.Exec(r.Context(), `delete from customer_request where workspace_id=$1::uuid and id=$2::uuid`, p.WorkspaceID, chi.URLParam(r, "requestID"))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Delete request failed", err.Error())
		return
	}
	if command.RowsAffected() == 0 {
		problem.Write(w, http.StatusNotFound, "Request not found", "")
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) LinkIssue(w http.ResponseWriter, r *http.Request) {
	h.linkIssueResponse(w, r, false)
}

func (h Handler) UnlinkIssue(w http.ResponseWriter, r *http.Request) {
	h.linkIssueResponse(w, r, true)
}

func (h Handler) linkIssueResponse(w http.ResponseWriter, r *http.Request, unlink bool) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	request, err := h.getRequest(r.Context(), p.WorkspaceID, chi.URLParam(r, "requestID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Request not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link issue failed", err.Error())
		return
	}
	issueParam := chi.URLParam(r, "issueID")
	if !unlink {
		var body linkInput
		_ = json.NewDecoder(r.Body).Decode(&body)
		issueParam = body.IssueID
	}
	issueID, err := resolveIssueID(r.Context(), h.DB, p.WorkspaceID, issueParam)
	if err != nil {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if unlink {
		_, err = h.DB.Exec(r.Context(), `delete from issue_customer_request where issue_id=$1::uuid and customer_request_id=$2::uuid`, issueID, request.ID)
	} else {
		err = linkIssue(r.Context(), h.DB, issueID, request.ID, p.UserID)
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link issue failed", err.Error())
		return
	}
	updated, err := h.getRequest(r.Context(), p.WorkspaceID, request.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link issue failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, updated)
}

func (h Handler) LinkProject(w http.ResponseWriter, r *http.Request) {
	h.linkProjectResponse(w, r, false)
}

func (h Handler) UnlinkProject(w http.ResponseWriter, r *http.Request) {
	h.linkProjectResponse(w, r, true)
}

func (h Handler) linkProjectResponse(w http.ResponseWriter, r *http.Request, unlink bool) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	request, err := h.getRequest(r.Context(), p.WorkspaceID, chi.URLParam(r, "requestID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Request not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link project failed", err.Error())
		return
	}
	projectParam := chi.URLParam(r, "projectID")
	if !unlink {
		var body linkInput
		_ = json.NewDecoder(r.Body).Decode(&body)
		projectParam = body.ProjectID
	}
	projectID, err := resolveProjectID(r.Context(), h.DB, p.WorkspaceID, projectParam)
	if err != nil {
		problem.Write(w, http.StatusNotFound, "Project not found", "")
		return
	}
	if unlink {
		_, err = h.DB.Exec(r.Context(), `delete from project_customer_request where project_id=$1::uuid and customer_request_id=$2::uuid`, projectID, request.ID)
	} else {
		err = linkProject(r.Context(), h.DB, projectID, request.ID, p.UserID)
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link project failed", err.Error())
		return
	}
	updated, err := h.getRequest(r.Context(), p.WorkspaceID, request.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link project failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, updated)
}

func (h Handler) ExportCustomer(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !allowCustomerRequests(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "Guests cannot access customer requests")
		return
	}
	customer, err := h.getCustomer(r.Context(), p.WorkspaceID, chi.URLParam(r, "customerID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Customer not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Export customer requests failed", err.Error())
		return
	}
	requests, err := h.requestsForCustomer(r.Context(), p.WorkspaceID, customer.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Export customer requests failed", err.Error())
		return
	}
	writeRequestsCSV(w, "customer-requests-"+customer.ID+".csv", requests)
}

func (h Handler) listCustomers(ctx context.Context, where string, args ...any) ([]Customer, error) {
	rows, err := h.DB.Query(ctx, `select `+customerColumns("c.")+`,
		(select count(*)::int from customer_request cr where cr.customer_id=c.id) as request_count,
		(select count(distinct icr.issue_id)::int from customer_request cr join issue_customer_request icr on icr.customer_request_id=cr.id where cr.customer_id=c.id) as issue_count,
		(select count(distinct pcr.project_id)::int from customer_request cr join project_customer_request pcr on pcr.customer_request_id=cr.id where cr.customer_id=c.id) as project_count
		from customer c where `+where+` order by c.updated_at desc, c.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Customer{}
	for rows.Next() {
		customer, err := scanCustomer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, customer)
	}
	return out, rows.Err()
}

func (h Handler) getCustomer(ctx context.Context, workspaceID, id string) (Customer, error) {
	return scanCustomer(h.DB.QueryRow(ctx, `select `+customerColumns("c.")+`,
		(select count(*)::int from customer_request cr where cr.customer_id=c.id) as request_count,
		(select count(distinct icr.issue_id)::int from customer_request cr join issue_customer_request icr on icr.customer_request_id=cr.id where cr.customer_id=c.id) as issue_count,
		(select count(distinct pcr.project_id)::int from customer_request cr join project_customer_request pcr on pcr.customer_request_id=cr.id where cr.customer_id=c.id) as project_count
		from customer c where c.workspace_id=$1::uuid and c.id=$2::uuid`, workspaceID, id))
}

func (h Handler) requestsForCustomer(ctx context.Context, workspaceID, customerID string) ([]CustomerRequest, error) {
	rows, err := h.DB.Query(ctx, `select `+requestColumns("cr.")+`, c.id::text, c.name, c.domain, c.tier, c.status
		from customer_request cr join customer c on c.id=cr.customer_id
		where cr.workspace_id=$1::uuid and cr.customer_id=$2::uuid
		order by cr.important desc, cr.created_at desc`, workspaceID, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRequestsWithLinks(ctx, h.DB, rows)
}

func (h Handler) getRequest(ctx context.Context, workspaceID, requestID string) (CustomerRequest, error) {
	request, err := scanRequestWithCustomer(h.DB.QueryRow(ctx, `select `+requestColumns("cr.")+`, c.id::text, c.name, c.domain, c.tier, c.status
		from customer_request cr join customer c on c.id=cr.customer_id
		where cr.workspace_id=$1::uuid and cr.id=$2::uuid`, workspaceID, requestID))
	if err != nil {
		return CustomerRequest{}, err
	}
	if err := hydrateRequestLinks(ctx, h.DB, &request); err != nil {
		return CustomerRequest{}, err
	}
	return request, nil
}

func (h Handler) relatedWork(ctx context.Context, workspaceID, customerID string) ([]LinkedIssue, []LinkedProject, error) {
	issues, err := linkedIssuesForCustomer(ctx, h.DB, workspaceID, customerID)
	if err != nil {
		return nil, nil, err
	}
	projects, err := linkedProjectsForCustomer(ctx, h.DB, workspaceID, customerID)
	if err != nil {
		return nil, nil, err
	}
	return issues, projects, nil
}

func customerColumns(prefix string) string {
	return prefix + `id::text, ` + prefix + `workspace_id::text, ` + prefix + `domain, ` + prefix + `name, ` + prefix + `revenue::float8, ` + prefix + `size, ` + prefix + `tier, ` + prefix + `status, ` + prefix + `owner_id, ` + prefix + `source, ` + prefix + `created_at, ` + prefix + `updated_at`
}

func requestColumns(prefix string) string {
	return prefix + `id::text, ` + prefix + `workspace_id::text, ` + prefix + `customer_id::text, ` + prefix + `title, ` + prefix + `body, ` + prefix + `source, ` + prefix + `source_url, ` + prefix + `external_provider, ` + prefix + `external_id, ` + prefix + `important, ` + prefix + `created_by_user_id, ` + prefix + `created_at, ` + prefix + `updated_at`
}

func scanCustomer(row scanner) (Customer, error) {
	var c Customer
	var domain, tier, status, owner, source pgtype.Text
	var revenue pgtype.Float8
	var size pgtype.Int4
	var createdAt, updatedAt time.Time
	if err := row.Scan(&c.ID, &c.WorkspaceID, &domain, &c.Name, &revenue, &size, &tier, &status, &owner, &source, &createdAt, &updatedAt, &c.RequestCount, &c.IssueCount, &c.ProjectCount); err != nil {
		return Customer{}, err
	}
	c.Domain = textPtr(domain)
	c.Revenue = floatPtr(revenue)
	c.Size = intPtr(size)
	c.Tier = textPtr(tier)
	c.Status = textPtr(status)
	c.OwnerID = textPtr(owner)
	c.Source = textPtr(source)
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	c.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return c, nil
}

func scanRequest(row scanner) (CustomerRequest, error) {
	var r CustomerRequest
	var body, source, sourceURL, externalProvider, externalID, createdBy pgtype.Text
	var createdAt, updatedAt time.Time
	if err := row.Scan(&r.ID, &r.WorkspaceID, &r.CustomerID, &r.Title, &body, &source, &sourceURL, &externalProvider, &externalID, &r.Important, &createdBy, &createdAt, &updatedAt); err != nil {
		return CustomerRequest{}, err
	}
	r.Body = textPtr(body)
	r.Source = textPtr(source)
	r.SourceURL = textPtr(sourceURL)
	r.ExternalProvider = textPtr(externalProvider)
	r.ExternalID = textPtr(externalID)
	r.CreatedByUserID = textPtr(createdBy)
	r.LinkedIssues = []LinkedIssue{}
	r.LinkedProjects = []LinkedProject{}
	r.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	r.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return r, nil
}

func scanRequestWithCustomer(row scanner) (CustomerRequest, error) {
	var r CustomerRequest
	var body, source, sourceURL, externalProvider, externalID, createdBy pgtype.Text
	var domain, tier, status pgtype.Text
	var createdAt, updatedAt time.Time
	if err := row.Scan(&r.ID, &r.WorkspaceID, &r.CustomerID, &r.Title, &body, &source, &sourceURL, &externalProvider, &externalID, &r.Important, &createdBy, &createdAt, &updatedAt, &r.Customer.ID, &r.Customer.Name, &domain, &tier, &status); err != nil {
		return CustomerRequest{}, err
	}
	r.Body = textPtr(body)
	r.Source = textPtr(source)
	r.SourceURL = textPtr(sourceURL)
	r.ExternalProvider = textPtr(externalProvider)
	r.ExternalID = textPtr(externalID)
	r.CreatedByUserID = textPtr(createdBy)
	r.Customer.Domain = textPtr(domain)
	r.Customer.Tier = textPtr(tier)
	r.Customer.Status = textPtr(status)
	r.LinkedIssues = []LinkedIssue{}
	r.LinkedProjects = []LinkedProject{}
	r.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	r.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return r, nil
}

func scanRequestsWithLinks(ctx context.Context, db queryer, rows pgx.Rows) ([]CustomerRequest, error) {
	out := []CustomerRequest{}
	for rows.Next() {
		var r CustomerRequest
		var body, source, sourceURL, externalProvider, externalID, createdBy pgtype.Text
		var domain, tier, status pgtype.Text
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&r.ID, &r.WorkspaceID, &r.CustomerID, &r.Title, &body, &source, &sourceURL, &externalProvider, &externalID, &r.Important, &createdBy, &createdAt, &updatedAt, &r.Customer.ID, &r.Customer.Name, &domain, &tier, &status); err != nil {
			return nil, err
		}
		r.Body = textPtr(body)
		r.Source = textPtr(source)
		r.SourceURL = textPtr(sourceURL)
		r.ExternalProvider = textPtr(externalProvider)
		r.ExternalID = textPtr(externalID)
		r.CreatedByUserID = textPtr(createdBy)
		r.Customer.Domain = textPtr(domain)
		r.Customer.Tier = textPtr(tier)
		r.Customer.Status = textPtr(status)
		r.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		r.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
		if err := hydrateRequestLinks(ctx, db, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func hydrateRequestLinks(ctx context.Context, db queryer, request *CustomerRequest) error {
	issues, err := linkedIssuesForRequest(ctx, db, request.ID)
	if err != nil {
		return err
	}
	projects, err := linkedProjectsForRequest(ctx, db, request.ID)
	if err != nil {
		return err
	}
	request.LinkedIssues = issues
	request.LinkedProjects = projects
	return nil
}

func linkedIssuesForRequest(ctx context.Context, db queryer, requestID string) ([]LinkedIssue, error) {
	rows, err := db.Query(ctx, `select i.id::text, i.identifier, i.title, t.key from issue_customer_request icr join issue i on i.id=icr.issue_id join team t on t.id=i.team_id where icr.customer_request_id=$1::uuid order by i.updated_at desc`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkedIssue{}
	for rows.Next() {
		var issue LinkedIssue
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey); err != nil {
			return nil, err
		}
		out = append(out, issue)
	}
	return out, rows.Err()
}

func linkedProjectsForRequest(ctx context.Context, db queryer, requestID string) ([]LinkedProject, error) {
	rows, err := db.Query(ctx, `select p.id::text, p.slug, p.name from project_customer_request pcr join project p on p.id=pcr.project_id where pcr.customer_request_id=$1::uuid order by p.updated_at desc`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkedProject{}
	for rows.Next() {
		var project LinkedProject
		if err := rows.Scan(&project.ID, &project.Slug, &project.Name); err != nil {
			return nil, err
		}
		out = append(out, project)
	}
	return out, rows.Err()
}

func linkedIssuesForCustomer(ctx context.Context, db queryer, workspaceID, customerID string) ([]LinkedIssue, error) {
	rows, err := db.Query(ctx, `select distinct i.id::text, i.identifier, i.title, t.key from customer_request cr join issue_customer_request icr on icr.customer_request_id=cr.id join issue i on i.id=icr.issue_id join team t on t.id=i.team_id where cr.workspace_id=$1::uuid and cr.customer_id=$2::uuid order by i.identifier`, workspaceID, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkedIssue{}
	for rows.Next() {
		var issue LinkedIssue
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey); err != nil {
			return nil, err
		}
		out = append(out, issue)
	}
	return out, rows.Err()
}

func linkedProjectsForCustomer(ctx context.Context, db queryer, workspaceID, customerID string) ([]LinkedProject, error) {
	rows, err := db.Query(ctx, `select distinct p.id::text, p.slug, p.name from customer_request cr join project_customer_request pcr on pcr.customer_request_id=cr.id join project p on p.id=pcr.project_id where cr.workspace_id=$1::uuid and cr.customer_id=$2::uuid order by p.name`, workspaceID, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkedProject{}
	for rows.Next() {
		var project LinkedProject
		if err := rows.Scan(&project.ID, &project.Slug, &project.Name); err != nil {
			return nil, err
		}
		out = append(out, project)
	}
	return out, rows.Err()
}

func resolveIssueID(ctx context.Context, db queryer, workspaceID, id string) (string, error) {
	id = strings.TrimSpace(id)
	var issueID string
	err := db.QueryRow(ctx, `select i.id::text from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and (i.id::text=$2 or i.identifier=$2) limit 1`, workspaceID, id).Scan(&issueID)
	return issueID, err
}

func resolveProjectID(ctx context.Context, db queryer, workspaceID, id string) (string, error) {
	id = strings.TrimSpace(id)
	var projectID string
	err := db.QueryRow(ctx, `select p.id::text from project p where p.workspace_id=$1::uuid and (p.id::text=$2 or p.slug=$2) limit 1`, workspaceID, id).Scan(&projectID)
	return projectID, err
}

func linkIssue(ctx context.Context, db execer, issueID, requestID, userID string) error {
	_, err := db.Exec(ctx, `insert into issue_customer_request (issue_id, customer_request_id, created_by_user_id) values ($1::uuid,$2::uuid,$3) on conflict do nothing`, issueID, requestID, userID)
	return err
}

func linkProject(ctx context.Context, db execer, projectID, requestID, userID string) error {
	_, err := db.Exec(ctx, `insert into project_customer_request (project_id, customer_request_id, created_by_user_id) values ($1::uuid,$2::uuid,$3) on conflict do nothing`, projectID, requestID, userID)
	return err
}

func customerSummary(c Customer) CustomerSummary {
	return CustomerSummary{ID: c.ID, Name: c.Name, Domain: c.Domain, Tier: c.Tier, Status: c.Status}
}

func writeRequestsCSV(w http.ResponseWriter, filename string, requests []CustomerRequest) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{"request_id", "customer_id", "customer_name", "customer_domain", "title", "body", "important", "source", "source_url", "created_at"})
	for _, request := range requests {
		domain := ""
		if request.Customer.Domain != nil {
			domain = *request.Customer.Domain
		}
		body := ""
		if request.Body != nil {
			body = *request.Body
		}
		source := ""
		if request.Source != nil {
			source = *request.Source
		}
		sourceURL := ""
		if request.SourceURL != nil {
			sourceURL = *request.SourceURL
		}
		_ = writer.Write([]string{request.ID, request.CustomerID, request.Customer.Name, domain, request.Title, body, strconv.FormatBool(request.Important), source, sourceURL, request.CreatedAt})
	}
	writer.Flush()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

func allowCustomerRequests(role string) bool {
	return role == "owner" || role == "admin" || role == "member"
}

func cleanPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func floatPtr(value pgtype.Float8) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func intPtr(value pgtype.Int4) *int32 {
	if !value.Valid {
		return nil
	}
	return &value.Int32
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\\`, `\\\\`)
	value = strings.ReplaceAll(value, `%`, `\\%`)
	value = strings.ReplaceAll(value, `_`, `\\_`)
	return value
}

type scanner interface{ Scan(dest ...any) error }

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
