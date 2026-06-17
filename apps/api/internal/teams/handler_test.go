package teams

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTeamKeyBase(t *testing.T) {
	if got := teamKeyBase("Linear Clone"); got != "LIN" {
		t.Fatalf("key = %q", got)
	}
	if got := teamKeyBase("123"); got != "WRK" {
		t.Fatalf("numeric key base = %q", got)
	}
}

func TestValidateKey(t *testing.T) {
	if err := validateKey("ENG"); err != nil {
		t.Fatalf("expected valid key: %v", err)
	}
	if err := validateKey("1BAD"); err == nil {
		t.Fatal("expected first-char validation failure")
	}
	if err := validateKey("TOO-LONG"); err == nil {
		t.Fatal("expected character validation failure")
	}
}

func TestParseCycleDate(t *testing.T) {
	if _, ok := parseCycleDate("2026-05-24"); !ok {
		t.Fatal("expected date-only cycle date")
	}
	if _, ok := parseCycleDate("not-a-date"); ok {
		t.Fatal("expected invalid cycle date")
	}
}

func TestEstimateOptions(t *testing.T) {
	if got := estimateOptions("not_in_use"); len(got) != 0 {
		t.Fatalf("estimates = %#v", got)
	}
	got := estimateOptions("fibonacci")
	if len(got) != 5 || got[0].Label != "1 point" || got[1].Label != "2 points" {
		t.Fatalf("estimates = %#v", got)
	}
}

func TestCreateIssueOptionStaticLists(t *testing.T) {
	if len(priorityOptions()) != 5 {
		t.Fatal("priority options drifted")
	}
	if len(dueDatePresets()) != 4 {
		t.Fatal("due date presets drifted")
	}
}

func TestDefaultWorkflowStatesIncludeTriageBeforeBacklog(t *testing.T) {
	states := defaultWorkflowStates()
	if len(states) == 0 {
		t.Fatal("default workflow states missing")
	}
	if states[0].Name != "Triage" || states[0].Category != "triage" {
		t.Fatalf("first default state = %#v", states[0])
	}
	if states[1].Name != "Backlog" || states[1].Category != "backlog" {
		t.Fatalf("second default state = %#v", states[1])
	}
	if states[0].Position >= states[1].Position {
		t.Fatalf("triage position should precede backlog: %#v", states[:2])
	}
}

func TestShouldBlockTriageStatusDelete(t *testing.T) {
	enabled := true
	disabled := false
	triageStatus := statusSummary{ID: "s-triage", Category: "triage"}
	backlogStatus := statusSummary{ID: "s-backlog", Category: "backlog"}

	if !shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, triageStatus, false) {
		t.Fatal("triage-enabled teams should keep a triage status")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, triageStatus, true) {
		t.Fatal("teams with another triage status should allow deleting this one")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &disabled}, triageStatus, false) {
		t.Fatal("triage-disabled teams should not be blocked by this guard")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, backlogStatus, false) {
		t.Fatal("non-triage statuses should not be blocked by this guard")
	}
}

func TestDuplicateIssueStatusIDDoesNotFallbackToTriage(t *testing.T) {
	statuses := map[string][]workflowStatus{
		"triage":  {{ID: "s-triage"}},
		"backlog": {{ID: "s-backlog"}},
	}
	ids := []string{"s-triage", "s-backlog"}

	if got := duplicateIssueStatusID(map[string]any{}, statuses, ids); got != "" {
		t.Fatalf("duplicate fallback = %q, want empty without canceled status", got)
	}

	statuses["canceled"] = []workflowStatus{{ID: "s-canceled"}}
	if got := duplicateIssueStatusID(map[string]any{}, statuses, ids); got != "s-canceled" {
		t.Fatalf("duplicate fallback = %q, want canceled", got)
	}

	settings := map[string]any{"duplicateIssueStatusId": "s-backlog"}
	if got := duplicateIssueStatusID(settings, statuses, ids); got != "s-backlog" {
		t.Fatalf("configured duplicate status = %q", got)
	}
}

func TestTriageDecisionRequestTracksPresentFields(t *testing.T) {
	var input triageDecisionRequest
	if err := input.UnmarshalJSON([]byte(`{"action":"accept","assigneeId":null,"labelIds":[]}`)); err != nil {
		t.Fatal(err)
	}
	if !input.hasField("assigneeId") || !input.hasField("labelIds") || input.hasField("projectId") {
		t.Fatalf("present fields = %#v", input.fieldsPresent)
	}
}

func TestApplyTriageDefaultMetadataOnlyForOmittedFields(t *testing.T) {
	settings := map[string]any{
		triageDefaultAssigneeKey: "user-default",
		triageDefaultLabelIDsKey: []any{"label-a", "label-b"},
		triageDefaultProjectKey:  "project-default",
		triageDefaultCycleKey:    "cycle-default",
	}
	input := triageDecisionRequest{fieldsPresent: map[string]bool{"assigneeId": true}, AssigneeID: nil}
	applyTriageDefaultMetadata(settings, &input)
	if input.AssigneeID != nil {
		t.Fatal("explicit null assignee should not be replaced by default")
	}
	if input.ProjectID == nil || *input.ProjectID != "project-default" || input.CycleID == nil || *input.CycleID != "cycle-default" {
		t.Fatalf("defaults not applied: %#v", input)
	}
	if len(input.LabelIDs) != 2 || input.LabelIDs[0] != "label-a" || input.LabelIDs[1] != "label-b" {
		t.Fatalf("label defaults = %#v", input.LabelIDs)
	}
}

func TestTriageSourceContextLabelsKnownSources(t *testing.T) {
	got := triageSourceContext(map[string]any{"source": "inbound_email", "sender": "customer@example.com", "title": "Need help"})
	if got["label"] != "Email" || got["sender"] != "customer@example.com" || got["title"] != "Need help" {
		t.Fatalf("source context = %#v", got)
	}
}

func TestTriageMetadataOptionsLoadsWorkspaceData(t *testing.T) {
	ctx := context.Background()
	pool := triageIntegrationDB(t)
	seed := seedTriageIntegrationData(t, ctx, pool)
	h := Handler{DB: pool}

	options, err := h.triageMetadataOptions(httptest.NewRequest("GET", "/", nil), triageTeam{ID: seed.teamID, WorkspaceID: seed.workspaceID, Settings: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}

	labels := optionIDs(t, options["labels"])
	if !labels[seed.workspaceLabelID] || !labels[seed.teamLabelID] || labels[seed.otherTeamLabelID] {
		t.Fatalf("labels = %#v", options["labels"])
	}
	cycles := optionIDs(t, options["cycles"])
	if !cycles[seed.cycleID] || cycles[seed.otherCycleID] {
		t.Fatalf("cycles = %#v", options["cycles"])
	}
	projects := optionIDs(t, options["projects"])
	if !projects[seed.projectID] || projects[seed.closedProjectID] {
		t.Fatalf("projects = %#v", options["projects"])
	}
	milestones := optionIDs(t, options["projectMilestones"])
	if !milestones[seed.milestoneID] || milestones[seed.closedMilestoneID] {
		t.Fatalf("milestones = %#v", options["projectMilestones"])
	}
	members := optionIDs(t, options["members"])
	if !members[seed.userID] || members[seed.nonTeamUserID] {
		t.Fatalf("members = %#v", options["members"])
	}
}

func TestTriageDecisionValidationRejectsWrongScopedResources(t *testing.T) {
	ctx := context.Background()
	pool := triageIntegrationDB(t)
	seed := seedTriageIntegrationData(t, ctx, pool)
	h := Handler{DB: pool}
	team := triageTeam{ID: seed.teamID, WorkspaceID: seed.workspaceID, Settings: map[string]any{}}

	cases := []struct {
		name  string
		input triageDecisionRequest
		want  string
	}{
		{"wrong team assignee", triageDecisionRequest{AssigneeID: &seed.nonTeamUserID}, "Assignee is not a member of this team"},
		{"wrong team label", triageDecisionRequest{LabelIDs: []string{seed.otherTeamLabelID}}, "Labels must belong to this workspace and team"},
		{"wrong team cycle", triageDecisionRequest{CycleID: &seed.otherCycleID}, "Cycle must belong to this team"},
		{"wrong project milestone", triageDecisionRequest{ProjectID: &seed.projectID, ProjectMilestoneID: &seed.otherProjectMilestoneID}, "Project milestone must belong to the selected project"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := h.validateTriageDecisionResources(ctx, team, tc.input)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}

	_, err := h.triageDestination(httptest.NewRequest("GET", "/", nil), seed.teamID, seed.otherStatusID)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("wrong-team destination err = %v, want pgx.ErrNoRows", err)
	}
}

type triageIntegrationSeed struct {
	workspaceID             string
	teamID                  string
	otherTeamID             string
	userID                  string
	nonTeamUserID           string
	workspaceLabelID        string
	teamLabelID             string
	otherTeamLabelID        string
	cycleID                 string
	otherCycleID            string
	projectID               string
	closedProjectID         string
	milestoneID             string
	closedMilestoneID       string
	otherProjectMilestoneID string
	otherStatusID           string
}

func triageIntegrationDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("EXPONENTIAL_API_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("EXPONENTIAL_API_DATABASE_URL or DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func seedTriageIntegrationData(t *testing.T, ctx context.Context, pool *pgxpool.Pool) triageIntegrationSeed {
	t.Helper()
	suffix := strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-"))
	suffix = strings.ReplaceAll(suffix, "_", "-")
	slug := "triage-" + suffix + "-" + time.Now().UTC().Format("150405000000000")
	seed := triageIntegrationSeed{userID: "triage-user-" + slug, nonTeamUserID: "triage-outsider-" + slug}

	if err := pool.QueryRow(ctx, `insert into workspace (name,url_slug) values ($1,$2) returning id::text`, "Triage Test", slug).Scan(&seed.workspaceID); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `delete from workspace where id=$1::uuid`, seed.workspaceID) })
	if _, err := pool.Exec(ctx, `insert into "user" (id,email,name,email_verified) values ($1,$2,'Triage User',true),($3,$4,'Triage Outsider',true)`, seed.userID, seed.userID+"@example.test", seed.nonTeamUserID, seed.nonTeamUserID+"@example.test"); err != nil {
		t.Fatalf("insert users: %v", err)
	}
	if _, err := pool.Exec(ctx, `insert into member (workspace_id,user_id,role) values ($1::uuid,$2,'member'),($1::uuid,$3,'member')`, seed.workspaceID, seed.userID, seed.nonTeamUserID); err != nil {
		t.Fatalf("insert members: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('Triage Team','TRI',$1::uuid) returning id::text`, seed.workspaceID).Scan(&seed.teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into team (name,key,workspace_id) values ('Other Team','OTH',$1::uuid) returning id::text`, seed.workspaceID).Scan(&seed.otherTeamID); err != nil {
		t.Fatalf("insert other team: %v", err)
	}
	if _, err := pool.Exec(ctx, `insert into team_member (team_id,user_id) values ($1::uuid,$2)`, seed.teamID, seed.userID); err != nil {
		t.Fatalf("insert team member: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into workflow_state (name,team_id,category,color,position) values ('Other Backlog',$1::uuid,'backlog','#999999',1) returning id::text`, seed.otherTeamID).Scan(&seed.otherStatusID); err != nil {
		t.Fatalf("insert other status: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into label (name,color,workspace_id) values ('Workspace Label','#111111',$1::uuid) returning id::text`, seed.workspaceID).Scan(&seed.workspaceLabelID); err != nil {
		t.Fatalf("insert workspace label: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Team Label','#222222',$1::uuid,$2::uuid) returning id::text`, seed.workspaceID, seed.teamID).Scan(&seed.teamLabelID); err != nil {
		t.Fatalf("insert team label: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into label (name,color,workspace_id,team_id) values ('Other Label','#333333',$1::uuid,$2::uuid) returning id::text`, seed.workspaceID, seed.otherTeamID).Scan(&seed.otherTeamLabelID); err != nil {
		t.Fatalf("insert other label: %v", err)
	}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	if err := pool.QueryRow(ctx, `insert into cycle (name,number,team_id,start_date,end_date) values ('Primary Cycle',1,$1::uuid,$2,$3) returning id::text`, seed.teamID, start, start.AddDate(0, 0, 14)).Scan(&seed.cycleID); err != nil {
		t.Fatalf("insert cycle: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into cycle (name,number,team_id,start_date,end_date) values ('Other Cycle',1,$1::uuid,$2,$3) returning id::text`, seed.otherTeamID, start, start.AddDate(0, 0, 14)).Scan(&seed.otherCycleID); err != nil {
		t.Fatalf("insert other cycle: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into project (name,description,slug,workspace_id) values ('Open Project','',$1,$2::uuid) returning id::text`, slug+"-open", seed.workspaceID).Scan(&seed.projectID); err != nil {
		t.Fatalf("insert project: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into project (name,description,slug,workspace_id,completed_at) values ('Closed Project','',$1,$2::uuid,now()) returning id::text`, slug+"-closed", seed.workspaceID).Scan(&seed.closedProjectID); err != nil {
		t.Fatalf("insert closed project: %v", err)
	}
	otherProjectID := ""
	if err := pool.QueryRow(ctx, `insert into project (name,description,slug,workspace_id) values ('Other Project','',$1,$2::uuid) returning id::text`, slug+"-other", seed.workspaceID).Scan(&otherProjectID); err != nil {
		t.Fatalf("insert other project: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into project_milestone (name,project_id,sort_order) values ('Open Milestone',$1::uuid,1) returning id::text`, seed.projectID).Scan(&seed.milestoneID); err != nil {
		t.Fatalf("insert milestone: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into project_milestone (name,project_id,sort_order) values ('Closed Milestone',$1::uuid,1) returning id::text`, seed.closedProjectID).Scan(&seed.closedMilestoneID); err != nil {
		t.Fatalf("insert closed milestone: %v", err)
	}
	if err := pool.QueryRow(ctx, `insert into project_milestone (name,project_id,sort_order) values ('Other Project Milestone',$1::uuid,1) returning id::text`, otherProjectID).Scan(&seed.otherProjectMilestoneID); err != nil {
		t.Fatalf("insert other milestone: %v", err)
	}
	return seed
}

func optionIDs(t *testing.T, raw any) map[string]bool {
	t.Helper()
	ids := map[string]bool{}
	switch items := raw.(type) {
	case []optionLabel:
		for _, item := range items {
			ids[item.ID] = true
		}
	case []optionCycle:
		for _, item := range items {
			ids[item.ID] = true
		}
	case []optionProject:
		for _, item := range items {
			ids[item.ID] = true
		}
	case []map[string]any:
		for _, item := range items {
			if id, ok := item["id"].(string); ok {
				ids[id] = true
			}
		}
	default:
		t.Fatalf("option payload = %#v", raw)
	}
	return ids
}
