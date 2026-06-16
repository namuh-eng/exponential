package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const protocolVersion = "2025-06-18"
const maxLimit = 50

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// Handler serves the hosted Streamable HTTP MCP endpoint. It deliberately uses
// the Go API database/auth boundary instead of the legacy Next.js API routes.
type Handler struct{ DB *pgxpool.Pool }

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type callParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type toolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	ReadOnly    bool           `json:"-"`
}

type mcpContext struct {
	Principal auth.Principal
}

type toolResult struct {
	Content []map[string]string `json:"content"`
	IsError bool                `json:"isError,omitempty"`
}

var toolDefinitions = []toolDefinition{
	readTool("exponential_search_issues", "Search visible workspace issues by title or identifier.", objectSchema(map[string]any{"query": stringSchema("Search text."), "limit": numberSchema()}, []string{"query"})),
	readTool("exponential_get_issue", "Get a visible issue by UUID or identifier.", objectSchema(map[string]any{"id": stringSchema("Issue UUID or identifier.")}, []string{"id"})),
	writeTool("exponential_create_issue", "Create an issue in a visible team.", objectSchema(map[string]any{"title": stringSchema(""), "team_id": stringSchema("Team UUID."), "teamId": stringSchema("Team UUID."), "description": stringSchema(""), "priority": enumSchema("none", "urgent", "high", "medium", "low"), "state_id": stringSchema(""), "stateId": stringSchema(""), "assignee_id": stringSchema(""), "assigneeId": stringSchema(""), "project_id": stringSchema(""), "projectId": stringSchema(""), "estimate": numberSchema(), "due_date": stringSchema("YYYY-MM-DD"), "dueDate": stringSchema("YYYY-MM-DD")}, []string{"title", "team_id"})),
	writeTool("exponential_update_issue", "Update core fields on a visible issue.", objectSchema(map[string]any{"id": stringSchema("Issue UUID or identifier."), "title": stringSchema(""), "description": stringSchema(""), "priority": enumSchema("none", "urgent", "high", "medium", "low"), "state_id": stringSchema(""), "stateId": stringSchema(""), "assignee_id": stringSchema(""), "assigneeId": stringSchema(""), "project_id": stringSchema(""), "projectId": stringSchema(""), "estimate": numberSchema(), "due_date": stringSchema("YYYY-MM-DD"), "dueDate": stringSchema("YYYY-MM-DD")}, []string{"id"})),
	readTool("exponential_list_projects", "List projects visible through the credential owner's team access.", objectSchema(map[string]any{"limit": numberSchema()}, nil)),
	readTool("exponential_get_project", "Get a visible project by UUID or slug.", objectSchema(map[string]any{"id": stringSchema("Project UUID or slug.")}, []string{"id"})),
	writeTool("exponential_create_project", "Create a workspace project.", objectSchema(map[string]any{"name": stringSchema(""), "slug": stringSchema(""), "description": stringSchema(""), "priority": enumSchema("none", "urgent", "high", "medium", "low"), "status": enumSchema("planned", "started", "paused", "completed", "canceled"), "team_ids": arraySchema(), "teamIds": arraySchema()}, []string{"name"})),
	writeTool("exponential_update_project", "Update a visible project by UUID or slug.", objectSchema(map[string]any{"id": stringSchema("Project UUID or slug."), "name": stringSchema(""), "slug": stringSchema(""), "description": stringSchema(""), "priority": enumSchema("none", "urgent", "high", "medium", "low"), "status": enumSchema("planned", "started", "paused", "completed", "canceled"), "team_ids": arraySchema(), "teamIds": arraySchema()}, []string{"id"})),
	readTool("exponential_list_teams", "List teams visible to the credential owner.", objectSchema(map[string]any{"limit": numberSchema()}, nil)),
	readTool("exponential_get_team_context", "Get context for a visible team by key or UUID.", objectSchema(map[string]any{"team": stringSchema("Team key or UUID.")}, []string{"team"})),
	readTool("exponential_list_team_issues", "List issues for a visible team by key or UUID.", objectSchema(map[string]any{"team": stringSchema("Team key or UUID."), "limit": numberSchema()}, []string{"team"})),
	readTool("exponential_list_team_cycles", "List cycles for a visible team by key or UUID.", objectSchema(map[string]any{"team": stringSchema("Team key or UUID."), "limit": numberSchema()}, []string{"team"})),
	readTool("exponential_list_views", "List custom views visible to the credential owner.", objectSchema(map[string]any{"limit": numberSchema()}, nil)),
	readTool("exponential_get_view", "Get a visible custom view by UUID.", objectSchema(map[string]any{"id": stringSchema("View UUID.")}, []string{"id"})),
	writeTool("exponential_create_view", "Create a custom view.", objectSchema(map[string]any{"name": stringSchema(""), "layout": enumSchema("list", "board", "timeline"), "isPersonal": boolSchema(), "teamId": stringSchema(""), "filterState": map[string]any{"type": "object"}}, []string{"name"})),
	writeTool("exponential_update_view", "Update a visible custom view by UUID.", objectSchema(map[string]any{"id": stringSchema("View UUID."), "name": stringSchema(""), "layout": enumSchema("list", "board", "timeline"), "isPersonal": boolSchema(), "teamId": stringSchema(""), "filterState": map[string]any{"type": "object"}}, []string{"id"})),
	writeTool("exponential_create_comment", "Create a comment on a visible issue.", objectSchema(map[string]any{"issue_id": stringSchema("Issue UUID or identifier."), "issueId": stringSchema("Issue UUID or identifier."), "body": stringSchema("")}, []string{"issue_id", "body"})),
	writeTool("exponential_update_comment", "Update one of the credential owner's comments.", objectSchema(map[string]any{"comment_id": stringSchema("Comment UUID."), "commentId": stringSchema("Comment UUID."), "body": stringSchema("")}, []string{"comment_id", "body"})),
	writeTool("exponential_delete_comment", "Delete one of the credential owner's comments.", objectSchema(map[string]any{"comment_id": stringSchema("Comment UUID."), "commentId": stringSchema("Comment UUID.")}, []string{"comment_id"})),
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Options("/", h.Options)
	r.Get("/", h.Get)
	r.Post("/", h.Post)
	return r
}

func (h Handler) Options(w http.ResponseWriter, _ *http.Request) {
	for k, v := range corsHeaders() {
		w.Header().Set(k, v)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	if _, ok := requirePAT(w, r); !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": "exponential", "transport": "streamable-http", "endpoint": "/v1/mcp", "auth": "bearer-pat", "tools": toolNames()})
}

func (h Handler) Post(w http.ResponseWriter, r *http.Request) {
	p, ok := requirePAT(w, r)
	if !ok {
		return
	}
	var body any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, rpcError(nil, -32700, "Parse error"))
		return
	}
	ctx := mcpContext{Principal: p}
	if requests, ok := body.([]any); ok {
		if len(requests) == 0 {
			writeJSON(w, http.StatusOK, rpcError(nil, -32600, "Batch must not be empty"))
			return
		}
		responses := make([]any, 0, len(requests))
		for _, entry := range requests {
			if response := h.handleRequest(r.Context(), ctx, entry); response != nil {
				responses = append(responses, response)
			}
		}
		if len(responses) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeJSON(w, http.StatusOK, responses)
		return
	}
	response := h.handleRequest(r.Context(), ctx, body)
	if response == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h Handler) handleRequest(ctx context.Context, mctx mcpContext, body any) any {
	record, ok := body.(map[string]any)
	id := record["id"]
	if !ok || record["jsonrpc"] != "2.0" {
		return rpcError(id, -32600, "Invalid JSON-RPC request")
	}
	method, _ := record["method"].(string)
	if method == "" {
		return rpcError(id, -32600, "Invalid JSON-RPC request")
	}
	if _, exists := record["id"]; !exists {
		return nil
	}
	switch method {
	case "initialize":
		return rpcResult(id, map[string]any{"protocolVersion": protocolVersion, "capabilities": map[string]any{"tools": map[string]any{"listChanged": false}}, "serverInfo": map[string]any{"name": "exponential", "version": "0.1.0"}})
	case "tools/list":
		return rpcResult(id, map[string]any{"tools": toolDefinitions})
	case "tools/call":
		params, _ := record["params"].(map[string]any)
		name, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]any)
		if args == nil {
			args = map[string]any{}
		}
		if name == "" {
			return rpcError(id, -32602, "Tool name is required")
		}
		return rpcResult(id, h.callTool(ctx, mctx, name, args))
	default:
		return rpcError(id, -32601, "Method not found: "+method)
	}
}

func (h Handler) callTool(ctx context.Context, mctx mcpContext, name string, args map[string]any) toolResult {
	started := time.Now().UTC()
	def, ok := findTool(name)
	if !ok {
		return h.finishTool(ctx, mctx, name, args, started, false, "Unknown tool: "+name, nil)
	}
	if def.ReadOnly {
		if !hasScope(mctx.Principal.Scopes, "read") {
			return h.finishTool(ctx, mctx, name, args, started, false, "Credential is missing a read scope", nil)
		}
	} else if !hasScope(mctx.Principal.Scopes, "write") {
		return h.finishTool(ctx, mctx, name, args, started, false, "Credential is missing a write scope for this tool", nil)
	}
	payload, err := h.executeTool(ctx, mctx.Principal, name, args)
	if err != nil {
		return h.finishTool(ctx, mctx, name, args, started, false, err.Error(), nil)
	}
	return h.finishTool(ctx, mctx, name, args, started, true, "", payload)
}

func (h Handler) finishTool(ctx context.Context, mctx mcpContext, name string, args map[string]any, started time.Time, success bool, message string, payload any) toolResult {
	target := targetFromPayload(payload)
	_ = h.audit(ctx, mctx.Principal, name, args, target, success, message, started)
	if !success {
		return toolResult{IsError: true, Content: []map[string]string{{"type": "text", "text": message}}}
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	return toolResult{Content: []map[string]string{{"type": "text", "text": string(raw)}}}
}

func (h Handler) executeTool(ctx context.Context, p auth.Principal, name string, args map[string]any) (any, error) {
	switch name {
	case "exponential_search_issues":
		return h.searchIssues(ctx, p, args)
	case "exponential_get_issue":
		return h.getIssue(ctx, p, requiredString(args, "id"))
	case "exponential_create_issue":
		return h.createIssue(ctx, p, args)
	case "exponential_update_issue":
		return h.updateIssue(ctx, p, args)
	case "exponential_list_projects":
		return h.listProjects(ctx, p, args)
	case "exponential_get_project":
		return h.getProject(ctx, p, requiredString(args, "id"))
	case "exponential_create_project":
		return h.createProject(ctx, p, args)
	case "exponential_update_project":
		return h.updateProject(ctx, p, args)
	case "exponential_list_teams":
		return h.listTeams(ctx, p, args)
	case "exponential_get_team_context":
		return h.getTeamContext(ctx, p, requiredString(args, "team"))
	case "exponential_list_team_issues":
		team, err := h.visibleTeam(ctx, p, requiredString(args, "team"))
		if err != nil {
			return nil, err
		}
		return h.listIssuesForTeam(ctx, p, team.ID, args)
	case "exponential_list_team_cycles":
		team, err := h.visibleTeam(ctx, p, requiredString(args, "team"))
		if err != nil {
			return nil, err
		}
		return h.listCyclesForTeam(ctx, team.ID, args)
	case "exponential_list_views":
		return h.listViews(ctx, p, args)
	case "exponential_get_view":
		return h.getView(ctx, p, requiredString(args, "id"))
	case "exponential_create_view":
		return h.createView(ctx, p, args)
	case "exponential_update_view":
		return h.updateView(ctx, p, args)
	case "exponential_create_comment":
		return h.createComment(ctx, p, args)
	case "exponential_update_comment":
		return h.updateComment(ctx, p, args)
	case "exponential_delete_comment":
		return h.deleteComment(ctx, p, args)
	}
	return nil, fmt.Errorf("Unknown tool: %s", name)
}

func (h Handler) searchIssues(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	query := strings.TrimSpace(requiredString(args, "query"))
	if query == "" {
		return nil, errors.New("query is required")
	}
	rows, err := h.DB.Query(ctx, `
		select i.id::text, i.identifier, i.title, i.priority::text, ws.name, ws.category::text, u.name, p.name, i.created_at, i.updated_at, t.key
		from issue i
		join team t on t.id=i.team_id
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		left join project p on p.id=i.project_id
		where t.workspace_id=$1::uuid and i.archived_at is null and (i.identifier ilike $3 or i.title ilike $3)
		  and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null or m.role in ('owner','admin'))
		order by i.updated_at desc, i.created_at desc
		limit $4`, p.WorkspaceID, p.UserID, "%"+query+"%", limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, identifier, title, priority, stateName, stateCategory, teamKey string
		var assigneeName, projectName *string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &identifier, &title, &priority, &stateName, &stateCategory, &assigneeName, &projectName, &createdAt, &updatedAt, &teamKey); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "identifier": identifier, "title": title, "priority": priority, "stateName": stateName, "stateCategory": stateCategory, "assigneeName": assigneeName, "projectName": projectName, "teamKey": teamKey, "createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano)})
	}
	return map[string]any{"issues": items}, rows.Err()
}

func (h Handler) getIssue(ctx context.Context, p auth.Principal, id string) (any, error) {
	filter := "i.identifier=$3"
	if uuidPattern.MatchString(id) {
		filter = "(i.id=$3::uuid or i.identifier=$3)"
	}
	row := h.DB.QueryRow(ctx, `
		select i.id::text, i.identifier, i.title, i.description, i.priority::text, i.estimate, i.due_date, i.created_at, i.updated_at, t.id::text, t.key, t.name, ws.id::text, ws.name, ws.category::text, u.name, p.id::text, p.name, p.slug
		from issue i
		join team t on t.id=i.team_id
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		left join project p on p.id=i.project_id
		where t.workspace_id=$1::uuid and i.archived_at is null and `+filter+`
		  and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null or m.role in ('owner','admin'))
		limit 1`, p.WorkspaceID, p.UserID, id)
	issue, err := scanIssueDetail(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("Issue not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"issue": issue}, nil
}

func (h Handler) createIssue(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	title := strings.TrimSpace(requiredString(args, "title"))
	teamID := strings.TrimSpace(firstString(args, "team_id", "teamId"))
	if title == "" || teamID == "" {
		return nil, errors.New("title and team_id are required")
	}
	if _, err := h.visibleTeam(ctx, p, teamID); err != nil {
		return nil, err
	}
	stateID := firstString(args, "state_id", "stateId")
	if stateID == "" {
		if err := h.DB.QueryRow(ctx, `select id::text from workflow_state where team_id=$1::uuid and category='backlog' order by coalesce(is_default,false) desc, position asc limit 1`, teamID).Scan(&stateID); err != nil {
			return nil, errors.New("No default workflow state found for team")
		}
	}
	priority := enumOrDefault(firstString(args, "priority"), "none", "urgent", "high", "medium", "low")
	var id string
	err := h.DB.QueryRow(ctx, `
		with next_num as (select coalesce(max(number),0)+1 as n from issue where team_id=$1::uuid), inserted as (
		insert into issue (number, identifier, title, description, team_id, state_id, creator_id, priority, assignee_id, project_id, estimate, due_date)
		select n, (select key from team where id=$1::uuid)||'-'||n, $2, nullif($3,''), $1::uuid, $4::uuid, $5, $6, nullif($7,'')::text, nullif($8,'')::uuid, $9, nullif($10,'')::timestamp from next_num returning id::text, identifier)
		select id from inserted`, teamID, title, firstString(args, "description"), stateID, p.UserID, priority, firstString(args, "assignee_id", "assigneeId"), firstString(args, "project_id", "projectId"), numberPtr(args["estimate"]), firstString(args, "due_date", "dueDate")).Scan(&id)
	if err != nil {
		return nil, err
	}
	return h.getIssue(ctx, p, id)
}

func (h Handler) updateIssue(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	id := requiredString(args, "id")
	found, err := h.issueID(ctx, p, id)
	if err != nil {
		return nil, err
	}
	_, err = h.DB.Exec(ctx, `update issue set
		title=coalesce(nullif($2,''), title),
		description=case when $3 then $4 else description end,
		priority=coalesce(nullif($5,'')::issue_priority, priority),
		state_id=coalesce(nullif($6,'')::uuid, state_id),
		assignee_id=case when $7 then nullif($8,'') else assignee_id end,
		project_id=case when $9 then nullif($10,'')::uuid else project_id end,
		estimate=case when $11 then $12 else estimate end,
		due_date=case when $13 then nullif($14,'')::timestamp else due_date end,
		updated_at=now()
		where id=$1::uuid`, found, firstString(args, "title"), hasAny(args, "description"), firstString(args, "description"), firstString(args, "priority"), firstString(args, "state_id", "stateId"), hasAny(args, "assignee_id", "assigneeId"), firstString(args, "assignee_id", "assigneeId"), hasAny(args, "project_id", "projectId"), firstString(args, "project_id", "projectId"), hasAny(args, "estimate"), numberPtr(args["estimate"]), hasAny(args, "due_date", "dueDate"), firstString(args, "due_date", "dueDate"))
	if err != nil {
		return nil, err
	}
	return h.getIssue(ctx, p, found)
}

func (h Handler) listProjects(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	rows, err := h.DB.Query(ctx, `select pr.id::text, pr.name, pr.description, pr.slug, pr.status::text, pr.priority::text, pr.created_at, pr.updated_at from project pr where pr.workspace_id=$1::uuid order by pr.updated_at desc, pr.created_at desc limit $2`, p.WorkspaceID, limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"projects": items}, rows.Err()
}

func (h Handler) getProject(ctx context.Context, p auth.Principal, id string) (any, error) {
	filter := "slug=$2"
	if uuidPattern.MatchString(id) {
		filter = "(id=$2::uuid or slug=$2)"
	}
	row := h.DB.QueryRow(ctx, `select id::text, name, description, slug, status::text, priority::text, created_at, updated_at from project where workspace_id=$1::uuid and `+filter+` limit 1`, p.WorkspaceID, id)
	item, err := scanProject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("Project not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"project": item}, nil
}

func (h Handler) createProject(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	name := strings.TrimSpace(requiredString(args, "name"))
	if name == "" {
		return nil, errors.New("name is required")
	}
	slug := strings.TrimSpace(firstString(args, "slug"))
	if slug == "" {
		slug = slugify(name)
	}
	priority := enumOrDefault(firstString(args, "priority"), "none", "urgent", "high", "medium", "low")
	status := enumOrDefault(firstString(args, "status"), "planned", "started", "paused", "completed", "canceled")
	var id string
	err := h.DB.QueryRow(ctx, `insert into project (name, slug, description, workspace_id, priority, status) values ($1,$2,nullif($3,''),$4::uuid,$5,$6) returning id::text`, name, slug, firstString(args, "description"), p.WorkspaceID, priority, status).Scan(&id)
	if err != nil {
		return nil, err
	}
	return h.getProject(ctx, p, id)
}

func (h Handler) updateProject(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	id := requiredString(args, "id")
	projectID, err := h.projectID(ctx, p, id)
	if err != nil {
		return nil, err
	}
	_, err = h.DB.Exec(ctx, `update project set name=coalesce(nullif($2,''),name), slug=coalesce(nullif($3,''),slug), description=case when $4 then $5 else description end, priority=coalesce(nullif($6,'')::project_priority, priority), status=coalesce(nullif($7,'')::project_status, status), updated_at=now() where id=$1::uuid`, projectID, firstString(args, "name"), firstString(args, "slug"), hasAny(args, "description"), firstString(args, "description"), firstString(args, "priority"), firstString(args, "status"))
	if err != nil {
		return nil, err
	}
	return h.getProject(ctx, p, projectID)
}

func (h Handler) listTeams(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	rows, err := h.DB.Query(ctx, visibleTeamsSQL()+` order by t.name asc, t.key asc limit $3`, p.WorkspaceID, p.UserID, limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []teamSummary{}
	for rows.Next() {
		item, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"teams": items}, rows.Err()
}

func (h Handler) getTeamContext(ctx context.Context, p auth.Principal, value string) (any, error) {
	team, err := h.visibleTeam(ctx, p, value)
	if err != nil {
		return nil, err
	}
	rows, err := h.DB.Query(ctx, `select id::text, name, category::text, position, coalesce(is_default,false) from workflow_state where team_id=$1::uuid order by position asc`, team.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := []map[string]any{}
	for rows.Next() {
		var id, name, category string
		var position float64
		var isDefault bool
		if err := rows.Scan(&id, &name, &category, &position, &isDefault); err != nil {
			return nil, err
		}
		states = append(states, map[string]any{"id": id, "name": name, "category": category, "position": position, "isDefault": isDefault})
	}
	return map[string]any{"team": team, "workflowStates": states}, rows.Err()
}

func (h Handler) listIssuesForTeam(ctx context.Context, p auth.Principal, teamID string, args map[string]any) (any, error) {
	rows, err := h.DB.Query(ctx, `
		select i.id::text, i.identifier, i.title, i.priority::text, ws.name, ws.category::text, u.name, p.name, i.created_at, i.updated_at, t.key
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		left join project p on p.id=i.project_id
		where i.team_id=$1::uuid and i.archived_at is null
		order by i.updated_at desc, i.created_at desc
		limit $2`, teamID, limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, identifier, title, priority, stateName, stateCategory, teamKey string
		var assigneeName, projectName *string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &identifier, &title, &priority, &stateName, &stateCategory, &assigneeName, &projectName, &createdAt, &updatedAt, &teamKey); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "identifier": identifier, "title": title, "priority": priority, "stateName": stateName, "stateCategory": stateCategory, "assigneeName": assigneeName, "projectName": projectName, "teamKey": teamKey, "createdAt": createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano)})
	}
	return map[string]any{"issues": items}, rows.Err()
}

func (h Handler) listCyclesForTeam(ctx context.Context, teamID string, args map[string]any) (any, error) {
	rows, err := h.DB.Query(ctx, `select id::text, name, number, start_date, end_date, coalesce(auto_rollover,true), created_at, updated_at from cycle where team_id=$1::uuid order by start_date desc, created_at desc limit $2`, teamID, limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name string
		var number int32
		var start, end, created, updated time.Time
		var auto bool
		if err := rows.Scan(&id, &name, &number, &start, &end, &auto, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "number": number, "startDate": start.UTC().Format(time.RFC3339Nano), "endDate": end.UTC().Format(time.RFC3339Nano), "autoRollover": auto, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)})
	}
	return map[string]any{"cycles": items}, rows.Err()
}

func (h Handler) listViews(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	rows, err := h.DB.Query(ctx, `select cv.id::text, cv.name, cv.layout::text, coalesce(cv.is_personal,true), cv.filter_state, cv.team_id::text, t.key, t.name, cv.created_at, cv.updated_at from custom_view cv left join team t on t.id=cv.team_id where cv.workspace_id=$1::uuid order by cv.name asc limit $2`, p.WorkspaceID, limit(args))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		item, err := scanView(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"views": items}, rows.Err()
}

func (h Handler) getView(ctx context.Context, p auth.Principal, id string) (any, error) {
	row := h.DB.QueryRow(ctx, `select cv.id::text, cv.name, cv.layout::text, coalesce(cv.is_personal,true), cv.filter_state, cv.team_id::text, t.key, t.name, cv.created_at, cv.updated_at from custom_view cv left join team t on t.id=cv.team_id where cv.id=$1::uuid and cv.workspace_id=$2::uuid limit 1`, id, p.WorkspaceID)
	item, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("View not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"view": item}, nil
}
func (h Handler) createView(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	name := strings.TrimSpace(requiredString(args, "name"))
	if name == "" {
		return nil, errors.New("name is required")
	}
	raw, _ := json.Marshal(mapOrEmpty(args["filterState"]))
	layout := enumOrDefault(firstString(args, "layout"), "list", "board", "timeline")
	var id string
	err := h.DB.QueryRow(ctx, `insert into custom_view (name, owner_id, workspace_id, layout, is_personal, filter_state, team_id) values ($1,$2,$3::uuid,$4,$5,$6::jsonb,nullif($7,'')::uuid) returning id::text`, name, p.UserID, p.WorkspaceID, layout, boolOrDefault(args["isPersonal"], true), raw, firstString(args, "teamId")).Scan(&id)
	if err != nil {
		return nil, err
	}
	return h.getView(ctx, p, id)
}
func (h Handler) updateView(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	id := requiredString(args, "id")
	raw, _ := json.Marshal(mapOrEmpty(args["filterState"]))
	_, err := h.DB.Exec(ctx, `update custom_view set name=coalesce(nullif($2,''),name), layout=coalesce(nullif($3,'')::view_layout,layout), is_personal=case when $4 then $5 else is_personal end, filter_state=case when $6 then $7::jsonb else filter_state end, team_id=case when $8 then nullif($9,'')::uuid else team_id end, updated_at=now() where id=$1::uuid and workspace_id=$10::uuid`, id, firstString(args, "name"), firstString(args, "layout"), hasAny(args, "isPersonal"), boolOrDefault(args["isPersonal"], true), hasAny(args, "filterState"), raw, hasAny(args, "teamId"), firstString(args, "teamId"), p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	return h.getView(ctx, p, id)
}
func (h Handler) createComment(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	issueID, err := h.issueID(ctx, p, firstString(args, "issue_id", "issueId"))
	if err != nil {
		return nil, err
	}
	body := strings.TrimSpace(requiredString(args, "body"))
	if body == "" {
		return nil, errors.New("body is required")
	}
	var id string
	err = h.DB.QueryRow(ctx, `insert into comment (body, issue_id, user_id) values ($1,$2::uuid,$3) returning id::text`, body, issueID, p.UserID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"comment": map[string]any{"id": id, "issue_id": issueID, "body": body}}, nil
}
func (h Handler) updateComment(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	id := firstString(args, "comment_id", "commentId")
	body := strings.TrimSpace(requiredString(args, "body"))
	if id == "" || body == "" {
		return nil, errors.New("comment_id and body are required")
	}
	tag, err := h.DB.Exec(ctx, `update comment set body=$1, updated_at=now() where id=$2::uuid and user_id=$3`, body, id, p.UserID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("Comment not found or unauthorized")
	}
	return map[string]any{"comment": map[string]any{"id": id, "body": body}}, nil
}
func (h Handler) deleteComment(ctx context.Context, p auth.Principal, args map[string]any) (any, error) {
	id := firstString(args, "comment_id", "commentId")
	if id == "" {
		return nil, errors.New("comment_id is required")
	}
	tag, err := h.DB.Exec(ctx, `delete from comment where id=$1::uuid and user_id=$2`, id, p.UserID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("Comment not found or unauthorized")
	}
	return map[string]any{"success": true, "comment_id": id}, nil
}

func (h Handler) issueID(ctx context.Context, p auth.Principal, id string) (string, error) {
	payload, err := h.getIssue(ctx, p, id)
	if err != nil {
		return "", err
	}
	issue := payload.(map[string]any)["issue"].(map[string]any)
	return issue["id"].(string), nil
}
func (h Handler) projectID(ctx context.Context, p auth.Principal, id string) (string, error) {
	payload, err := h.getProject(ctx, p, id)
	if err != nil {
		return "", err
	}
	project := payload.(map[string]any)["project"].(map[string]any)
	return project["id"].(string), nil
}

type teamSummary struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Key        string  `json:"key"`
	Icon       *string `json:"icon"`
	IsPrivate  bool    `json:"isPrivate"`
	IssueCount int32   `json:"issueCount"`
	CreatedAt  string  `json:"createdAt"`
}

func (h Handler) visibleTeam(ctx context.Context, p auth.Principal, value string) (teamSummary, error) {
	filter := "upper(t.key)=upper($3)"
	if uuidPattern.MatchString(value) {
		filter = "(t.id=$3::uuid or upper(t.key)=upper($3))"
	}
	row := h.DB.QueryRow(ctx, visibleTeamsSQL()+` and `+filter+` limit 1`, p.WorkspaceID, p.UserID, value)
	team, err := scanTeam(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return team, errors.New("Team not found")
	}
	return team, err
}
func visibleTeamsSQL() string {
	return `select t.id::text, t.name, t.key, t.icon, coalesce(t.is_private,false), coalesce(t.issue_count,0), t.created_at from team t join member m on m.workspace_id=t.workspace_id and m.user_id=$2 left join team_member tm on tm.team_id=t.id and tm.user_id=$2 where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null or m.role in ('owner','admin'))`
}

func (h Handler) audit(ctx context.Context, p auth.Principal, name string, args map[string]any, target any, success bool, message string, started time.Time) error {
	if h.DB == nil {
		return nil
	}
	meta := map[string]any{"toolName": name, "arguments": redactArgs(args), "target": target, "success": success, "error": nil, "startedAt": started.Format(time.RFC3339Nano)}
	if !success {
		meta["error"] = message
	}
	raw, _ := json.Marshal(meta)
	_, err := h.DB.Exec(ctx, `insert into personal_access_token_audit_log (token_id,user_id,workspace_id,action,metadata) values (nullif($1,'')::uuid,$2,$3::uuid,'mcp_tool_call',$4::jsonb)`, p.APIKeyID, p.UserID, p.WorkspaceID, raw)
	return err
}

func requirePAT(w http.ResponseWriter, r *http.Request) (auth.Principal, bool) {
	p, ok := auth.FromContext(r.Context())
	if !ok || !p.IsPersonalAccessToken {
		problem.Write(w, http.StatusUnauthorized, "MCP requires a bearer personal access token", "")
		return auth.Principal{}, false
	}
	return p, true
}
func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if strings.EqualFold(strings.TrimSpace(scope), required) {
			return true
		}
	}
	return false
}
func findTool(name string) (toolDefinition, bool) {
	for _, tool := range toolDefinitions {
		if tool.Name == name {
			return tool, true
		}
	}
	return toolDefinition{}, false
}
func toolNames() []string {
	out := make([]string, 0, len(toolDefinitions))
	for _, tool := range toolDefinitions {
		out = append(out, tool.Name)
	}
	return out
}
func readTool(name, desc string, schema map[string]any) toolDefinition {
	return toolDefinition{Name: name, Description: desc, InputSchema: schema, ReadOnly: true}
}
func writeTool(name, desc string, schema map[string]any) toolDefinition {
	return toolDefinition{Name: name, Description: desc, InputSchema: schema}
}
func objectSchema(props map[string]any, required []string) map[string]any {
	schema := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
func stringSchema(desc string) map[string]any {
	schema := map[string]any{"type": "string"}
	if desc != "" {
		schema["description"] = desc
	}
	return schema
}
func numberSchema() map[string]any {
	return map[string]any{"type": "number", "minimum": 1, "maximum": maxLimit}
}
func boolSchema() map[string]any { return map[string]any{"type": "boolean"} }
func enumSchema(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}
func arraySchema() map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
}
func rpcResult(id any, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}
func rpcError(id any, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	for k, v := range corsHeaders() {
		w.Header().Set(k, v)
	}
	problem.JSON(w, status, value)
}
func corsHeaders() map[string]string {
	return map[string]string{"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
}
func requiredString(args map[string]any, key string) string { return firstString(args, key) }
func firstString(args map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := args[key]; ok {
			if text, ok := value.(string); ok {
				return strings.TrimSpace(text)
			}
		}
	}
	return ""
}
func hasAny(args map[string]any, keys ...string) bool {
	for _, key := range keys {
		if _, ok := args[key]; ok {
			return true
		}
	}
	return false
}
func limit(args map[string]any) int {
	value, ok := args["limit"].(float64)
	if !ok || value < 1 {
		return 20
	}
	if value > maxLimit {
		return maxLimit
	}
	return int(value)
}
func numberPtr(value any) *float64 {
	switch v := value.(type) {
	case float64:
		return &v
	case int:
		f := float64(v)
		return &f
	}
	return nil
}
func boolOrDefault(value any, fallback bool) bool {
	if v, ok := value.(bool); ok {
		return v
	}
	return fallback
}
func enumOrDefault(value, fallback string, allowed ...string) string {
	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}
	return fallback
}
func mapOrEmpty(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}
func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	out := regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(value, "-")
	out = regexp.MustCompile(`-+`).ReplaceAllString(out, "-")
	return strings.Trim(out, "-")
}
func redactArgs(args map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range args {
		if regexp.MustCompile(`(?i)authorization|token|cookie|secret`).MatchString(k) {
			continue
		}
		switch k {
		case "body", "description":
			out[k] = fmt.Sprintf("<redacted:%d>", len(fmt.Sprint(v)))
		default:
			out[k] = v
		}
	}
	return out
}
func targetFromPayload(payload any) any {
	rec, ok := payload.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range []string{"issue", "project", "view", "comment"} {
		if item, ok := rec[key].(map[string]any); ok {
			return map[string]any{"type": key, "id": item["id"]}
		}
	}
	return nil
}

func scanIssueDetail(row pgx.Row) (map[string]any, error) {
	var id, identifier, title, priority, teamID, teamKey, teamName, stateID, stateName, stateCategory string
	var description, assigneeName, projectID, projectName, projectSlug *string
	var estimate *float64
	var dueDate *time.Time
	var created, updated time.Time
	if err := row.Scan(&id, &identifier, &title, &description, &priority, &estimate, &dueDate, &created, &updated, &teamID, &teamKey, &teamName, &stateID, &stateName, &stateCategory, &assigneeName, &projectID, &projectName, &projectSlug); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "identifier": identifier, "title": title, "description": description, "priority": priority, "estimate": estimate, "dueDate": formatTimePtr(dueDate), "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano), "team": map[string]any{"id": teamID, "key": teamKey, "name": teamName}, "state": map[string]any{"id": stateID, "name": stateName, "category": stateCategory}, "assigneeName": assigneeName, "project": map[string]any{"id": projectID, "name": projectName, "slug": projectSlug}}, nil
}
func scanProject(row pgx.Row) (map[string]any, error) {
	var id, name, slug, status, priority string
	var description *string
	var created, updated time.Time
	if err := row.Scan(&id, &name, &description, &slug, &status, &priority, &created, &updated); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": name, "description": description, "slug": slug, "status": status, "priority": priority, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)}, nil
}
func scanTeam(row pgx.Row) (teamSummary, error) {
	var team teamSummary
	var created time.Time
	if err := row.Scan(&team.ID, &team.Name, &team.Key, &team.Icon, &team.IsPrivate, &team.IssueCount, &created); err != nil {
		return team, err
	}
	team.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	return team, nil
}
func scanView(row pgx.Row) (map[string]any, error) {
	var id, name, layout string
	var personal bool
	var raw []byte
	var teamID, teamKey, teamName *string
	var created, updated time.Time
	if err := row.Scan(&id, &name, &layout, &personal, &raw, &teamID, &teamKey, &teamName, &created, &updated); err != nil {
		return nil, err
	}
	var filter any
	_ = json.Unmarshal(raw, &filter)
	return map[string]any{"id": id, "name": name, "layout": layout, "isPersonal": personal, "filterState": filter, "teamId": teamID, "teamKey": teamKey, "teamName": teamName, "createdAt": created.UTC().Format(time.RFC3339Nano), "updatedAt": updated.UTC().Format(time.RFC3339Nano)}, nil
}
func formatTimePtr(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}
