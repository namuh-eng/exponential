package teams

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
)

func TestRecurringRelationshipAuthorizationWithDatabase(t *testing.T) {
	databaseURL := os.Getenv("EXPONENTIAL_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set EXPONENTIAL_TEST_DATABASE_URL to run DB-backed authorization regression test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	migrateRecurringTestDatabase(t, ctx, pool)
	seed := seedRecurringAuthzFixture(t, ctx, pool)
	h := Handler{DB: pool}
	r := httptest.NewRequest("POST", "/v1/teams/A1/recurring-issues", nil)
	team := teamRecordForSettings{ID: seed.TeamA1, WorkspaceID: seed.WorkspaceA}

	if err := h.validateRecurringRelationships(r, team, &seed.StateA1, &seed.UserA, []string{seed.LabelWorkspaceA, seed.LabelTeamA1}, &seed.ProjectA); err != nil {
		t.Fatalf("valid relationships rejected: %v", err)
	}
	if err := h.validateRecurringRelationships(r, team, &seed.StateA2, nil, nil, nil); err == nil || err.title != "Workflow state not found" {
		t.Fatalf("cross-team state error = %#v", err)
	}
	if err := h.validateRecurringRelationships(r, team, nil, &seed.UserB, nil, nil); err == nil || err.title != "Assignee is not a workspace member" {
		t.Fatalf("cross-workspace assignee error = %#v", err)
	}
	if err := h.validateRecurringRelationships(r, team, nil, nil, []string{seed.LabelTeamA2}, nil); err == nil || err.title != "Label not found" {
		t.Fatalf("cross-team label error = %#v", err)
	}
	if err := h.validateRecurringRelationships(r, team, nil, nil, nil, &seed.ProjectB); err == nil || err.title != "Project not found" {
		t.Fatalf("cross-workspace project error = %#v", err)
	}

	createBody := `{"title":"Hostile recurring create","cadenceConfig":{"cadence":"weekly"},"startAt":"2026-06-10T00:00:00Z","projectId":"` + seed.ProjectB + `"}`
	createReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues", strings.NewReader(createBody))
	createReq = createReq.WithContext(auth.WithPrincipal(createReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	createReq = withRecurringURLParam(createReq, "key", seed.TeamA1Key)
	createRec := httptest.NewRecorder()
	h.CreateRecurringIssue(createRec, createReq)
	if createRec.Code < 400 {
		t.Fatalf("cross-workspace recurring project create status = %d, body = %s", createRec.Code, createRec.Body.String())
	}
	var createdCount int
	mustScanRecurring(t, pool.QueryRow(ctx, `select count(*)::int from recurring_issue where title='Hostile recurring create' and team_id=$1::uuid`, seed.TeamA1).Scan(&createdCount))
	if createdCount != 0 {
		t.Fatalf("hostile recurring create persisted %d row(s)", createdCount)
	}

	var recurringID string
	cadenceRaw := []byte(`{"cadence":"weekly"}`)
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into recurring_issue (workspace_id,team_id,creator_id,title,state_id,priority,label_ids,cadence_config,timezone,start_at,next_run_at,enabled) values ($1::uuid,$2::uuid,$3,'Existing recurring',$4::uuid,'medium','[]'::jsonb,$5::jsonb,'UTC','2026-06-10T00:00:00Z','2026-06-17T00:00:00Z',true) returning id::text`, seed.WorkspaceA, seed.TeamA1, seed.UserA, seed.StateA1, cadenceRaw).Scan(&recurringID))
	updateBody := `{"projectId":"` + seed.ProjectB + `"}`
	updateReq := httptest.NewRequest(http.MethodPatch, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues/"+recurringID, strings.NewReader(updateBody))
	updateReq = updateReq.WithContext(auth.WithPrincipal(updateReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	updateReq = withRecurringURLParam(updateReq, "key", seed.TeamA1Key)
	updateReq = withRecurringURLParam(updateReq, "id", recurringID)
	updateRec := httptest.NewRecorder()
	h.UpdateRecurringIssue(updateRec, updateReq)
	if updateRec.Code < 400 {
		t.Fatalf("cross-workspace recurring project update status = %d, body = %s", updateRec.Code, updateRec.Body.String())
	}
	var projectID *string
	mustScanRecurring(t, pool.QueryRow(ctx, `select project_id::text from recurring_issue where id=$1::uuid`, recurringID).Scan(&projectID))
	if projectID != nil {
		t.Fatalf("hostile recurring update changed project_id to %q", *projectID)
	}

	invalidLabelBody := `{"title":"Invalid label recurring create","cadenceConfig":{"cadence":"weekly"},"startAt":"2026-06-10T00:00:00Z","labelIds":["not-a-uuid"]}`
	invalidLabelReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues", strings.NewReader(invalidLabelBody))
	invalidLabelReq = invalidLabelReq.WithContext(auth.WithPrincipal(invalidLabelReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	invalidLabelReq = withRecurringURLParam(invalidLabelReq, "key", seed.TeamA1Key)
	invalidLabelRec := httptest.NewRecorder()
	h.CreateRecurringIssue(invalidLabelRec, invalidLabelReq)
	if invalidLabelRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid recurring label id status = %d, body = %s", invalidLabelRec.Code, invalidLabelRec.Body.String())
	}

	invalidRecurringStateBody := `{"title":"Invalid state recurring create","cadenceConfig":{"cadence":"weekly"},"startAt":"2026-06-10T00:00:00Z","stateId":"not-a-uuid"}`
	invalidRecurringStateReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues", strings.NewReader(invalidRecurringStateBody))
	invalidRecurringStateReq = invalidRecurringStateReq.WithContext(auth.WithPrincipal(invalidRecurringStateReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	invalidRecurringStateReq = withRecurringURLParam(invalidRecurringStateReq, "key", seed.TeamA1Key)
	invalidRecurringStateRec := httptest.NewRecorder()
	h.CreateRecurringIssue(invalidRecurringStateRec, invalidRecurringStateReq)
	if invalidRecurringStateRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid recurring state id status = %d, body = %s", invalidRecurringStateRec.Code, invalidRecurringStateRec.Body.String())
	}

	invalidRecurringProjectBody := `{"title":"Invalid project recurring create","cadenceConfig":{"cadence":"weekly"},"startAt":"2026-06-10T00:00:00Z","projectId":"not-a-uuid"}`
	invalidRecurringProjectReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues", strings.NewReader(invalidRecurringProjectBody))
	invalidRecurringProjectReq = invalidRecurringProjectReq.WithContext(auth.WithPrincipal(invalidRecurringProjectReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	invalidRecurringProjectReq = withRecurringURLParam(invalidRecurringProjectReq, "key", seed.TeamA1Key)
	invalidRecurringProjectRec := httptest.NewRecorder()
	h.CreateRecurringIssue(invalidRecurringProjectRec, invalidRecurringProjectReq)
	if invalidRecurringProjectRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid recurring project id status = %d, body = %s", invalidRecurringProjectRec.Code, invalidRecurringProjectRec.Body.String())
	}

	invalidUpdateIDReq := httptest.NewRequest(http.MethodPatch, "/v1/teams/"+seed.TeamA1Key+"/recurring-issues/not-a-uuid", strings.NewReader(`{"projectId":"`+seed.ProjectA+`"}`))
	invalidUpdateIDReq = invalidUpdateIDReq.WithContext(auth.WithPrincipal(invalidUpdateIDReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	invalidUpdateIDReq = withRecurringURLParam(invalidUpdateIDReq, "key", seed.TeamA1Key)
	invalidUpdateIDReq = withRecurringURLParam(invalidUpdateIDReq, "id", "not-a-uuid")
	invalidUpdateIDRec := httptest.NewRecorder()
	h.UpdateRecurringIssue(invalidUpdateIDRec, invalidUpdateIDReq)
	if invalidUpdateIDRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid recurring update id status = %d, body = %s", invalidUpdateIDRec.Code, invalidUpdateIDRec.Body.String())
	}

	triageBody := `{"action":"accept","confirmed":true,"destinationStateId":"` + seed.StateA1 + `","projectId":"` + seed.ProjectB + `"}`
	triageReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/triage/"+seed.TriageIssueA1+"/decision", strings.NewReader(triageBody))
	triageReq = triageReq.WithContext(auth.WithPrincipal(triageReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	triageReq = withRecurringURLParam(triageReq, "key", seed.TeamA1Key)
	triageReq = withRecurringURLParam(triageReq, "issueID", seed.TriageIssueA1)
	triageRec := httptest.NewRecorder()
	h.DecideTriage(triageRec, triageReq)
	if triageRec.Code < 400 {
		t.Fatalf("cross-workspace triage project status = %d, body = %s", triageRec.Code, triageRec.Body.String())
	}
	var triageProjectID *string
	mustScanRecurring(t, pool.QueryRow(ctx, `select project_id::text from issue where id=$1::uuid`, seed.TriageIssueA1).Scan(&triageProjectID))
	if triageProjectID == nil || *triageProjectID != seed.ProjectA {
		t.Fatalf("hostile triage changed project_id to %#v", triageProjectID)
	}

	triageLabelBody := `{"action":"accept","confirmed":true,"destinationStateId":"` + seed.StateA1 + `","labelIds":["` + seed.LabelTeamA2 + `"]}`
	triageLabelReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/triage/"+seed.TriageIssueA1+"/decision", strings.NewReader(triageLabelBody))
	triageLabelReq = triageLabelReq.WithContext(auth.WithPrincipal(triageLabelReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	triageLabelReq = withRecurringURLParam(triageLabelReq, "key", seed.TeamA1Key)
	triageLabelReq = withRecurringURLParam(triageLabelReq, "issueID", seed.TriageIssueA1)
	triageLabelRec := httptest.NewRecorder()
	h.DecideTriage(triageLabelRec, triageLabelReq)
	if triageLabelRec.Code < 400 {
		t.Fatalf("cross-team triage label status = %d, body = %s", triageLabelRec.Code, triageLabelRec.Body.String())
	}
	var triageLabelCount int
	mustScanRecurring(t, pool.QueryRow(ctx, `select count(*)::int from issue_label where issue_id=$1::uuid and label_id=$2::uuid`, seed.TriageIssueA1, seed.LabelTeamA2).Scan(&triageLabelCount))
	if triageLabelCount != 0 {
		t.Fatalf("hostile triage label inserted %d row(s)", triageLabelCount)
	}

	badTriageStateBody := `{"action":"accept","confirmed":true,"destinationStateId":"not-a-uuid"}`
	badTriageStateReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/triage/"+seed.TriageIssueA1+"/decision", strings.NewReader(badTriageStateBody))
	badTriageStateReq = badTriageStateReq.WithContext(auth.WithPrincipal(badTriageStateReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	badTriageStateReq = withRecurringURLParam(badTriageStateReq, "key", seed.TeamA1Key)
	badTriageStateReq = withRecurringURLParam(badTriageStateReq, "issueID", seed.TriageIssueA1)
	badTriageStateRec := httptest.NewRecorder()
	h.DecideTriage(badTriageStateRec, badTriageStateReq)
	if badTriageStateRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid triage destination id status = %d, body = %s", badTriageStateRec.Code, badTriageStateRec.Body.String())
	}

	badTriageIssueReq := httptest.NewRequest(http.MethodPost, "/v1/teams/"+seed.TeamA1Key+"/triage/not-a-uuid/decision", strings.NewReader(`{"action":"accept","confirmed":true,"destinationStateId":"`+seed.StateA1+`"}`))
	badTriageIssueReq = badTriageIssueReq.WithContext(auth.WithPrincipal(badTriageIssueReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	badTriageIssueReq = withRecurringURLParam(badTriageIssueReq, "key", seed.TeamA1Key)
	badTriageIssueReq = withRecurringURLParam(badTriageIssueReq, "issueID", "not-a-uuid")
	badTriageIssueRec := httptest.NewRecorder()
	h.DecideTriage(badTriageIssueRec, badTriageIssueReq)
	if badTriageIssueRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid triage issue id status = %d, body = %s", badTriageIssueRec.Code, badTriageIssueRec.Body.String())
	}
}

func withRecurringURLParam(r *http.Request, key, value string) *http.Request {
	routeCtx := chi.RouteContext(r.Context())
	if routeCtx == nil {
		routeCtx = chi.NewRouteContext()
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, routeCtx))
	}
	routeCtx.URLParams.Add(key, value)
	return r
}

func migrateRecurringTestDatabase(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	files, err := filepath.Glob("../../../../packages/proto/migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if strings.TrimSpace(string(body)) == "" {
			continue
		}
		if _, err := pool.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply %s: %v", filepath.Base(file), err)
		}
	}
}

type recurringAuthzFixture struct {
	WorkspaceA      string
	WorkspaceB      string
	TeamA1          string
	TeamA1Key       string
	TeamA2          string
	UserA           string
	UserB           string
	StateA1         string
	StateA2         string
	TriageStateA1   string
	LabelWorkspaceA string
	LabelTeamA1     string
	LabelTeamA2     string
	ProjectA        string
	ProjectB        string
	TriageIssueA1   string
}

func seedRecurringAuthzFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) recurringAuthzFixture {
	t.Helper()
	suffix := strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
	short := suffix[len(suffix)-8:]
	seed := recurringAuthzFixture{
		UserA: "rec-user-a-" + suffix,
		UserB: "rec-user-b-" + suffix,
	}
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into workspace (name,url_slug) values ($1,$2),($3,$4) returning id::text`, "Recurring Workspace A", "rwa-"+suffix, "Recurring Workspace B", "rwb-"+suffix).Scan(&seed.WorkspaceA))
	mustScanRecurring(t, pool.QueryRow(ctx, `select id::text from workspace where url_slug=$1`, "rwb-"+suffix).Scan(&seed.WorkspaceB))
	_, err := pool.Exec(ctx, `insert into "user" (id,email,name) values ($1,$2,$3),($4,$5,$6)`, seed.UserA, seed.UserA+"@example.test", "User A", seed.UserB, seed.UserB+"@example.test", "User B")
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `insert into member (user_id,workspace_id) values ($1,$2::uuid),($3,$4::uuid)`, seed.UserA, seed.WorkspaceA, seed.UserB, seed.WorkspaceB)
	if err != nil {
		t.Fatal(err)
	}
	seed.TeamA1Key = "R1" + short[len(short)-4:]
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('RA1',$1,$2::uuid) returning id::text`, seed.TeamA1Key, seed.WorkspaceA).Scan(&seed.TeamA1))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('RA2',$1,$2::uuid) returning id::text`, "R2"+short[len(short)-4:], seed.WorkspaceA).Scan(&seed.TeamA2))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color) values ('Backlog',$1::uuid,'backlog','#000000') returning id::text`, seed.TeamA1).Scan(&seed.StateA1))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color) values ('Backlog',$1::uuid,'backlog','#000000') returning id::text`, seed.TeamA2).Scan(&seed.StateA2))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color) values ('Triage',$1::uuid,'triage','#000000') returning id::text`, seed.TeamA1).Scan(&seed.TriageStateA1))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Workspace Label','#000000',$1::uuid,null) returning id::text`, seed.WorkspaceA).Scan(&seed.LabelWorkspaceA))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Team A1 Label','#000000',$1::uuid,$2::uuid) returning id::text`, seed.WorkspaceA, seed.TeamA1).Scan(&seed.LabelTeamA1))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Team A2 Label','#000000',$1::uuid,$2::uuid) returning id::text`, seed.WorkspaceA, seed.TeamA2).Scan(&seed.LabelTeamA2))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into project (name,slug,workspace_id) values ('Recurring Project A',$1,$2::uuid) returning id::text`, "rec-project-a-"+suffix, seed.WorkspaceA).Scan(&seed.ProjectA))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into project (name,slug,workspace_id) values ('Recurring Project B',$1,$2::uuid) returning id::text`, "rec-project-b-"+suffix, seed.WorkspaceB).Scan(&seed.ProjectB))
	mustScanRecurring(t, pool.QueryRow(ctx, `insert into issue (number,identifier,title,team_id,state_id,creator_id,project_id) values (1,$1,'Triage Issue',$2::uuid,$3::uuid,$4,$5::uuid) returning id::text`, "TRI-"+short, seed.TeamA1, seed.TriageStateA1, seed.UserA, seed.ProjectA).Scan(&seed.TriageIssueA1))
	return seed
}

func mustScanRecurring(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
