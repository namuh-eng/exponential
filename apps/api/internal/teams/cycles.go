package teams

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Cycle struct {
	ID                  string  `json:"id"`
	Name                *string `json:"name"`
	Number              int32   `json:"number"`
	TeamID              string  `json:"teamId"`
	StartDate           string  `json:"startDate"`
	EndDate             string  `json:"endDate"`
	AutoRollover        bool    `json:"autoRollover"`
	IssueCount          int32   `json:"issueCount"`
	CompletedIssueCount int32   `json:"completedIssueCount"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

type cyclesResponse struct {
	Team   cycleTeam `json:"team"`
	Cycles []Cycle   `json:"cycles"`
}

type cycleTeam struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Key                string `json:"key"`
	CyclesEnabled      bool   `json:"cyclesEnabled"`
	CycleStartDay      *int32 `json:"cycleStartDay"`
	CycleDurationWeeks *int32 `json:"cycleDurationWeeks"`
	Timezone           string `json:"timezone"`
}

type cycleRequest struct {
	Name         *string `json:"name"`
	StartDate    string  `json:"start_date"`
	StartDateAlt string  `json:"startDate"`
	EndDate      string  `json:"end_date"`
	EndDateAlt   string  `json:"endDate"`
	AutoRollover *bool   `json:"auto_rollover"`
	AutoAlt      *bool   `json:"autoRollover"`
}

type cycleDetailResponse struct {
	Team          teamIssuesTeam         `json:"team"`
	Cycle         Cycle                  `json:"cycle"`
	Groups        []teamIssueGroup       `json:"groups"`
	FilterOptions teamIssueFilterOptions `json:"filterOptions"`
}

func (r *cycleRequest) normalize() {
	if r.StartDate == "" {
		r.StartDate = r.StartDateAlt
	}
	if r.EndDate == "" {
		r.EndDate = r.EndDateAlt
	}
	if r.AutoRollover == nil {
		r.AutoRollover = r.AutoAlt
	}
}

func (h Handler) ListCycles(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamByKey(r.Context(), p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "List cycles failed", err.Error())
		return
	}
	cycles, err := h.loadCycles(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "List cycles failed", err.Error())
		return
	}
	problem.JSON(w, 200, cyclesResponse{Team: team, Cycles: cycles})
}

func (h Handler) CreateCycle(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamByKey(r.Context(), p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	var input cycleRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	input.normalize()
	start, end, ok := parseCycleRange(input.StartDate, input.EndDate)
	if !ok {
		problem.Write(w, 400, "Start and end dates must use YYYY-MM-DD format", "")
		return
	}
	if start.After(end) {
		problem.Write(w, 400, "Cycle end date must be on or after the start date", "")
		return
	}
	if overlaps, err := h.cycleOverlaps(r.Context(), team.ID, "", start, end); err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	} else if overlaps {
		problem.Write(w, 409, "Cycle dates overlap with an existing cycle", "")
		return
	}
	auto := true
	if input.AutoRollover != nil {
		auto = *input.AutoRollover
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var nextNumber int32
	if err := tx.QueryRow(r.Context(), `select coalesce(max(number),0)+1 from cycle where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	cycle, err := scanCycle(tx.QueryRow(r.Context(), `
		insert into cycle (name, number, team_id, start_date, end_date, auto_rollover)
		values ($1,$2,$3::uuid,$4,$5,$6)
		returning `+cycleReturningColumns()+`, 0::int, 0::int`, normalizedName(input.Name), nextNumber, team.ID, start, end, auto))
	if err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	if err := insertTeamOperation(r.Context(), tx, p.WorkspaceID, "cycle", cycle.ID, "created", cycle, p.UserID); err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create cycle failed", err.Error())
		return
	}
	problem.JSON(w, 201, cycle)
}

func (h Handler) GetCycle(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	cycle, err := h.findCycle(r.Context(), team.ID, chi.URLParam(r, "cycleID"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Cycle not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	teamIDs, err := h.hierarchyTeamIDs(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	states, err := h.teamIssueStates(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	issues, err := h.teamIssueRecords(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	cycleIssues := make([]teamIssueRecord, 0, len(issues))
	for _, issue := range issues {
		if issue.CycleID != nil && *issue.CycleID == cycle.ID {
			cycleIssues = append(cycleIssues, issue)
		}
	}
	labels, err := h.teamIssueLabels(r.Context(), issueIDsForTeamIssues(cycleIssues))
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	creators, err := h.creatorNames(r.Context(), cycleIssues)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	cycles, err := h.cycleNames(r.Context(), issues)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	teams, err := h.teamOptions(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load cycle failed", err.Error())
		return
	}
	issueResponse := buildTeamIssuesResponse(team, states, cycleIssues, labels, creators, cycles, teams)
	problem.JSON(w, 200, cycleDetailResponse{
		Team:          issueResponse.Team,
		Cycle:         cycle,
		Groups:        issueResponse.Groups,
		FilterOptions: issueResponse.FilterOptions,
	})
}

func (h Handler) UpdateCycle(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamByKey(r.Context(), p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	cycleID := chi.URLParam(r, "cycleID")
	existing, err := h.findCycle(r.Context(), team.ID, cycleID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Cycle not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	var input cycleRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	input.normalize()
	start, _ := time.Parse(time.RFC3339, existing.StartDate)
	end, _ := time.Parse(time.RFC3339, existing.EndDate)
	if strings.TrimSpace(input.StartDate) != "" {
		parsed, ok := parseCycleDate(input.StartDate)
		if !ok {
			problem.Write(w, 400, "Start and end dates must use YYYY-MM-DD format", "")
			return
		}
		start = parsed
	}
	if strings.TrimSpace(input.EndDate) != "" {
		parsed, ok := parseCycleDate(input.EndDate)
		if !ok {
			problem.Write(w, 400, "Start and end dates must use YYYY-MM-DD format", "")
			return
		}
		end = parsed
	}
	if start.After(end) {
		problem.Write(w, 400, "Cycle end date must be on or after the start date", "")
		return
	}
	if overlaps, err := h.cycleOverlaps(r.Context(), team.ID, cycleID, start, end); err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	} else if overlaps {
		problem.Write(w, 409, "Cycle dates overlap with an existing cycle", "")
		return
	}
	auto := existing.AutoRollover
	if input.AutoRollover != nil {
		auto = *input.AutoRollover
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	updated, err := scanCycle(tx.QueryRow(r.Context(), `update cycle set name=$1, start_date=$2, end_date=$3, auto_rollover=$4, updated_at=now() where id=$5::uuid and team_id=$6::uuid returning `+cycleReturningColumns()+`, $7::int, $8::int`, normalizedName(input.Name), start, end, auto, cycleID, team.ID, existing.IssueCount, existing.CompletedIssueCount))
	if err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	if err := insertTeamOperation(r.Context(), tx, p.WorkspaceID, "cycle", updated.ID, "updated", updated, p.UserID); err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update cycle failed", err.Error())
		return
	}
	problem.JSON(w, 200, updated)
}

func (h Handler) DeleteCycle(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamByKey(r.Context(), p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	cycleID := chi.URLParam(r, "cycleID")
	existing, err := h.findCycle(r.Context(), team.ID, cycleID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Cycle not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `update issue set cycle_id=null, updated_at=now() where cycle_id=$1::uuid and team_id=$2::uuid`, cycleID, team.ID); err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from cycle where id=$1::uuid and team_id=$2::uuid`, cycleID, team.ID); err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	if err := insertTeamOperation(r.Context(), tx, p.WorkspaceID, "cycle", existing.ID, "deleted", existing, p.UserID); err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete cycle failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) findTeamByKey(ctx context.Context, workspaceID, key string) (cycleTeam, error) {
	var team cycleTeam
	var timezone *string
	err := h.DB.QueryRow(ctx, `select id::text, name, key, coalesce(cycles_enabled,false), cycle_start_day, cycle_duration_weeks, timezone from team where workspace_id=$1::uuid and key=$2 and deleted_at is null`, workspaceID, key).Scan(&team.ID, &team.Name, &team.Key, &team.CyclesEnabled, &team.CycleStartDay, &team.CycleDurationWeeks, &timezone)
	if timezone != nil {
		team.Timezone = *timezone
	}
	return team, err
}

func (h Handler) loadCycles(ctx context.Context, teamID string) ([]Cycle, error) {
	rows, err := h.DB.Query(ctx, `select `+cycleColumns()+`, coalesce(count(i.id),0)::int, coalesce(count(i.completed_at),0)::int from cycle c left join issue i on i.cycle_id=c.id where c.team_id=$1::uuid group by c.id order by c.start_date desc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cycles := []Cycle{}
	for rows.Next() {
		c, err := scanCycle(rows)
		if err != nil {
			return nil, err
		}
		cycles = append(cycles, c)
	}
	return cycles, rows.Err()
}

func (h Handler) findCycle(ctx context.Context, teamID, id string) (Cycle, error) {
	return scanCycle(h.DB.QueryRow(ctx, `select `+cycleColumns()+`, coalesce(count(i.id),0)::int, coalesce(count(i.completed_at),0)::int from cycle c left join issue i on i.cycle_id=c.id where c.team_id=$1::uuid and c.id=$2::uuid group by c.id`, teamID, id))
}

func (h Handler) cycleOverlaps(ctx context.Context, teamID, excludeID string, start, end time.Time) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from cycle where team_id=$1::uuid and ($2::uuid is null or id<>$2::uuid) and start_date <= $4 and end_date >= $3 limit 1`, teamID, nullableUUID(excludeID), start, end).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func cycleColumns() string {
	return cycleColumnsWithPrefix("c.")
}

func cycleReturningColumns() string {
	return cycleColumnsWithPrefix("")
}

func cycleColumnsWithPrefix(prefix string) string {
	return prefix + `id::text, ` + prefix + `name, ` + prefix + `number, ` + prefix + `team_id::text, ` + prefix + `start_date, ` + prefix + `end_date, coalesce(` + prefix + `auto_rollover,true), ` + prefix + `created_at, ` + prefix + `updated_at`
}

func scanCycle(row scanner) (Cycle, error) {
	var c Cycle
	var start, end time.Time
	var created, updated time.Time
	if err := row.Scan(&c.ID, &c.Name, &c.Number, &c.TeamID, &start, &end, &c.AutoRollover, &created, &updated, &c.IssueCount, &c.CompletedIssueCount); err != nil {
		return Cycle{}, err
	}
	c.StartDate = start.UTC().Format(time.RFC3339)
	c.EndDate = end.UTC().Format(time.RFC3339)
	c.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	c.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return c, nil
}

func parseCycleRange(startValue, endValue string) (time.Time, time.Time, bool) {
	start, ok := parseCycleDate(startValue)
	if !ok {
		return time.Time{}, time.Time{}, false
	}
	end, ok := parseCycleDate(endValue)
	if !ok {
		return time.Time{}, time.Time{}, false
	}
	return start, end, true
}

func parseCycleDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed, true
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed, true
	}
	return time.Time{}, false
}

func normalizedName(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
func nullableUUID(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}
func insertTeamOperation(ctx context.Context, tx pgx.Tx, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into operation (workspace_id, entity_type, entity_id, op_type, payload, version, created_by) values ($1::uuid,$2,$3,$4,$5::jsonb,nextval('operation_version_seq'),$6)`, workspaceID, entityType, entityID, opType, body, createdBy)
	return err
}
func formatNullableTimestamp(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	v := ts.Time.UTC().Format(time.RFC3339Nano)
	return &v
}
