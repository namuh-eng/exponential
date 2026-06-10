package issues

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

func TestIssueRelationshipAuthorizationWithDatabase(t *testing.T) {
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
	migrateTestDatabase(t, ctx, pool)
	seed := seedIssueAuthzFixture(t, ctx, pool)

	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, &seed.UserA, &seed.IssueA1, &seed.ProjectA, &seed.MilestoneA, &seed.CycleA1); err != nil {
		t.Fatalf("valid relationships rejected: %v", err)
	}
	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, &seed.UserB, nil, nil, nil, nil); err == nil || !strings.Contains(err.title, "Assignee") {
		t.Fatalf("cross-workspace assignee error = %#v", err)
	}
	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, nil, &seed.IssueA2, nil, nil, nil); err == nil || err.title != "Parent issue not found" {
		t.Fatalf("cross-team parent error = %#v", err)
	}
	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, nil, nil, &seed.ProjectB, nil, nil); err == nil || err.title != "Project not found" {
		t.Fatalf("cross-workspace project error = %#v", err)
	}
	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, nil, nil, nil, &seed.MilestoneB, nil); err == nil || err.title != "Project milestone not found" {
		t.Fatalf("cross-workspace milestone error = %#v", err)
	}
	if err := assertIssueRelationships(ctx, pool, seed.WorkspaceA, seed.TeamA1, nil, nil, nil, nil, &seed.CycleA2); err == nil || err.title != "Cycle not found" {
		t.Fatalf("cross-team cycle error = %#v", err)
	}

	h := Handler{DB: pool}
	createBody := `{"title":"Hostile create","team_id":"` + seed.TeamA1 + `","project_id":"` + seed.ProjectB + `"}`
	createReq := httptest.NewRequest(http.MethodPost, "/v1/issues", strings.NewReader(createBody))
	createReq = createReq.WithContext(auth.WithPrincipal(createReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	createRec := httptest.NewRecorder()
	h.Create(createRec, createReq)
	if createRec.Code < 400 {
		t.Fatalf("cross-workspace project create status = %d, body = %s", createRec.Code, createRec.Body.String())
	}
	var createdCount int
	mustScan(t, pool.QueryRow(ctx, `select count(*)::int from issue where title='Hostile create' and team_id=$1::uuid`, seed.TeamA1).Scan(&createdCount))
	if createdCount != 0 {
		t.Fatalf("hostile create persisted %d issue(s)", createdCount)
	}

	updateBody := `{"project_id":"` + seed.ProjectB + `"}`
	updateReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/"+seed.IssueA1, strings.NewReader(updateBody))
	updateReq = updateReq.WithContext(auth.WithPrincipal(updateReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	updateReq = withIssueURLParam(updateReq, "id", seed.IssueA1)
	updateRec := httptest.NewRecorder()
	h.Update(updateRec, updateReq)
	if updateRec.Code < 400 {
		t.Fatalf("cross-workspace project update status = %d, body = %s", updateRec.Code, updateRec.Body.String())
	}
	var projectID, milestoneID *string
	mustScan(t, pool.QueryRow(ctx, `select project_id::text, project_milestone_id::text from issue where id=$1::uuid`, seed.IssueA1).Scan(&projectID, &milestoneID))
	if projectID == nil || *projectID != seed.ProjectA {
		t.Fatalf("hostile update changed project_id to %#v", projectID)
	}
	if milestoneID == nil || *milestoneID != seed.MilestoneA {
		t.Fatalf("hostile update changed project_milestone_id to %#v", milestoneID)
	}

	moveBody := `{"project_id":"` + seed.ProjectA2 + `"}`
	moveReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/"+seed.IssueA1, strings.NewReader(moveBody))
	moveReq = moveReq.WithContext(auth.WithPrincipal(moveReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	moveReq = withIssueURLParam(moveReq, "id", seed.IssueA1)
	moveRec := httptest.NewRecorder()
	h.Update(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("valid project move update status = %d, body = %s", moveRec.Code, moveRec.Body.String())
	}
	mustScan(t, pool.QueryRow(ctx, `select project_id::text, project_milestone_id::text from issue where id=$1::uuid`, seed.IssueA1).Scan(&projectID, &milestoneID))
	if projectID == nil || *projectID != seed.ProjectA2 {
		t.Fatalf("project move update project_id = %#v", projectID)
	}
	if milestoneID != nil {
		t.Fatalf("project move update left stale milestone_id = %q", *milestoneID)
	}

	bulkRejectBody := `{"issueIds":["` + seed.IssueA1 + `"],"updates":{"projectId":"` + seed.ProjectB + `"}}`
	bulkRejectReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/bulk", strings.NewReader(bulkRejectBody))
	bulkRejectReq = bulkRejectReq.WithContext(auth.WithPrincipal(bulkRejectReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	bulkRejectRec := httptest.NewRecorder()
	h.Bulk(bulkRejectRec, bulkRejectReq)
	if bulkRejectRec.Code < 400 {
		t.Fatalf("cross-workspace bulk project status = %d, body = %s", bulkRejectRec.Code, bulkRejectRec.Body.String())
	}

	bulkBadIssueBody := `{"issueIds":["not-a-uuid"],"updates":{"projectId":"` + seed.ProjectA + `"}}`
	bulkBadIssueReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/bulk", strings.NewReader(bulkBadIssueBody))
	bulkBadIssueReq = bulkBadIssueReq.WithContext(auth.WithPrincipal(bulkBadIssueReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	bulkBadIssueRec := httptest.NewRecorder()
	h.Bulk(bulkBadIssueRec, bulkBadIssueReq)
	if bulkBadIssueRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid bulk issue id status = %d, body = %s", bulkBadIssueRec.Code, bulkBadIssueRec.Body.String())
	}

	bulkMoveBody := `{"issueIds":["` + seed.IssueA1 + `"],"updates":{"projectId":"` + seed.ProjectA + `"}}`
	bulkMoveReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/bulk", strings.NewReader(bulkMoveBody))
	bulkMoveReq = bulkMoveReq.WithContext(auth.WithPrincipal(bulkMoveReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	bulkMoveRec := httptest.NewRecorder()
	h.Bulk(bulkMoveRec, bulkMoveReq)
	if bulkMoveRec.Code != http.StatusOK {
		t.Fatalf("valid bulk project move status = %d, body = %s", bulkMoveRec.Code, bulkMoveRec.Body.String())
	}
	mustScan(t, pool.QueryRow(ctx, `select project_id::text, project_milestone_id::text from issue where id=$1::uuid`, seed.IssueA1).Scan(&projectID, &milestoneID))
	if projectID == nil || *projectID != seed.ProjectA {
		t.Fatalf("bulk project move project_id = %#v", projectID)
	}
	if milestoneID != nil {
		t.Fatalf("bulk project move left stale milestone_id = %q", *milestoneID)
	}

	bulkLabelBody := `{"issueIds":["` + seed.IssueA1 + `"],"updates":{"labelIds":["` + seed.LabelA2 + `"]}}`
	bulkLabelReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/bulk", strings.NewReader(bulkLabelBody))
	bulkLabelReq = bulkLabelReq.WithContext(auth.WithPrincipal(bulkLabelReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	bulkLabelRec := httptest.NewRecorder()
	h.Bulk(bulkLabelRec, bulkLabelReq)
	if bulkLabelRec.Code < 400 {
		t.Fatalf("cross-team bulk label status = %d, body = %s", bulkLabelRec.Code, bulkLabelRec.Body.String())
	}
	var labelCount int
	mustScan(t, pool.QueryRow(ctx, `select count(*)::int from issue_label where issue_id=$1::uuid and label_id=$2::uuid`, seed.IssueA1, seed.LabelA2).Scan(&labelCount))
	if labelCount != 0 {
		t.Fatalf("hostile bulk label inserted %d row(s)", labelCount)
	}

	bulkBadStateBody := `{"issueIds":["` + seed.IssueA1 + `"],"updates":{"stateId":"not-a-uuid"}}`
	bulkBadStateReq := httptest.NewRequest(http.MethodPatch, "/v1/issues/bulk", strings.NewReader(bulkBadStateBody))
	bulkBadStateReq = bulkBadStateReq.WithContext(auth.WithPrincipal(bulkBadStateReq.Context(), auth.Principal{UserID: seed.UserA, WorkspaceID: seed.WorkspaceA}))
	bulkBadStateRec := httptest.NewRecorder()
	h.Bulk(bulkBadStateRec, bulkBadStateReq)
	if bulkBadStateRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid bulk state id status = %d, body = %s", bulkBadStateRec.Code, bulkBadStateRec.Body.String())
	}
}

func withIssueURLParam(r *http.Request, key, value string) *http.Request {
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, routeCtx))
}

func migrateTestDatabase(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
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

type issueAuthzFixture struct {
	WorkspaceA string
	WorkspaceB string
	TeamA1     string
	TeamA2     string
	UserA      string
	UserB      string
	IssueA1    string
	IssueA2    string
	ProjectA   string
	ProjectA2  string
	ProjectB   string
	MilestoneA string
	MilestoneB string
	CycleA1    string
	CycleA2    string
	LabelA2    string
}

func seedIssueAuthzFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) issueAuthzFixture {
	t.Helper()
	suffix := strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
	short := suffix[len(suffix)-8:]
	seed := issueAuthzFixture{
		UserA: "user-a-" + suffix,
		UserB: "user-b-" + suffix,
	}
	mustScan(t, pool.QueryRow(ctx, `insert into workspace (name,url_slug) values ($1,$2),($3,$4) returning id::text`, "Workspace A", "wa-"+suffix, "Workspace B", "wb-"+suffix).Scan(&seed.WorkspaceA))
	mustScan(t, pool.QueryRow(ctx, `select id::text from workspace where url_slug=$1`, "wb-"+suffix).Scan(&seed.WorkspaceB))
	_, err := pool.Exec(ctx, `insert into "user" (id,email,name) values ($1,$2,$3),($4,$5,$6)`, seed.UserA, seed.UserA+"@example.test", "User A", seed.UserB, seed.UserB+"@example.test", "User B")
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `insert into member (user_id,workspace_id) values ($1,$2::uuid),($3,$4::uuid)`, seed.UserA, seed.WorkspaceA, seed.UserB, seed.WorkspaceB)
	if err != nil {
		t.Fatal(err)
	}
	mustScan(t, pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('A1',$1,$2::uuid) returning id::text`, "A1"+short[len(short)-4:], seed.WorkspaceA).Scan(&seed.TeamA1))
	mustScan(t, pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('A2',$1,$2::uuid) returning id::text`, "A2"+short[len(short)-4:], seed.WorkspaceA).Scan(&seed.TeamA2))
	var teamB string
	mustScan(t, pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('B1',$1,$2::uuid) returning id::text`, "B1"+short[len(short)-4:], seed.WorkspaceB).Scan(&teamB))
	var stateA1, stateA2 string
	mustScan(t, pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color) values ('Backlog',$1::uuid,'backlog','#000000') returning id::text`, seed.TeamA1).Scan(&stateA1))
	mustScan(t, pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color) values ('Backlog',$1::uuid,'backlog','#000000') returning id::text`, seed.TeamA2).Scan(&stateA2))
	mustScan(t, pool.QueryRow(ctx, `insert into project (name,slug,workspace_id) values ('Project A',$1,$2::uuid) returning id::text`, "project-a-"+suffix, seed.WorkspaceA).Scan(&seed.ProjectA))
	mustScan(t, pool.QueryRow(ctx, `insert into project (name,slug,workspace_id) values ('Project A2',$1,$2::uuid) returning id::text`, "project-a2-"+suffix, seed.WorkspaceA).Scan(&seed.ProjectA2))
	mustScan(t, pool.QueryRow(ctx, `insert into project (name,slug,workspace_id) values ('Project B',$1,$2::uuid) returning id::text`, "project-b-"+suffix, seed.WorkspaceB).Scan(&seed.ProjectB))
	mustScan(t, pool.QueryRow(ctx, `insert into project_milestone (name,project_id) values ('Milestone A',$1::uuid) returning id::text`, seed.ProjectA).Scan(&seed.MilestoneA))
	mustScan(t, pool.QueryRow(ctx, `insert into project_milestone (name,project_id) values ('Milestone B',$1::uuid) returning id::text`, seed.ProjectB).Scan(&seed.MilestoneB))
	mustScan(t, pool.QueryRow(ctx, `insert into cycle (number,team_id,start_date,end_date) values (1,$1::uuid,now(),now()+interval '7 days') returning id::text`, seed.TeamA1).Scan(&seed.CycleA1))
	mustScan(t, pool.QueryRow(ctx, `insert into cycle (number,team_id,start_date,end_date) values (1,$1::uuid,now(),now()+interval '7 days') returning id::text`, seed.TeamA2).Scan(&seed.CycleA2))
	mustScan(t, pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Team A2 Label','#000000',$1::uuid,$2::uuid) returning id::text`, seed.WorkspaceA, seed.TeamA2).Scan(&seed.LabelA2))
	mustScan(t, pool.QueryRow(ctx, `insert into issue (number,identifier,title,team_id,state_id,creator_id,project_id,project_milestone_id) values (1,$1,'Issue A1',$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid) returning id::text`, "A1-"+short, seed.TeamA1, stateA1, seed.UserA, seed.ProjectA, seed.MilestoneA).Scan(&seed.IssueA1))
	mustScan(t, pool.QueryRow(ctx, `insert into issue (number,identifier,title,team_id,state_id,creator_id) values (1,$1,'Issue A2',$2::uuid,$3::uuid,$4) returning id::text`, "A2-"+short, seed.TeamA2, stateA2, seed.UserA).Scan(&seed.IssueA2))
	_ = teamB
	return seed
}

func mustScan(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
