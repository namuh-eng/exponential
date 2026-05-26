package analytics

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type TeamCount struct {
	TeamID   string `json:"teamId"`
	TeamName string `json:"teamName"`
	Count    int32  `json:"count"`
}

type completedTeamCount struct {
	TeamID         string `json:"teamId"`
	TeamName       string `json:"teamName"`
	CompletedCount int32  `json:"completedCount"`
}

type activeTeamCount struct {
	TeamID      string `json:"teamId"`
	TeamName    string `json:"teamName"`
	ActiveCount int32  `json:"activeCount"`
}

type workspaceResponse struct {
	WorkspaceID         string               `json:"workspaceId"`
	CompletedLast30Days []completedTeamCount `json:"completedLast30Days"`
	ActiveIssues        []activeTeamCount    `json:"activeIssues"`
	Period              string               `json:"period"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/workspace", h.Workspace)
	return r
}

func (h Handler) Workspace(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	completed, err := h.completedLast30Days(r, p.WorkspaceID, time.Now().AddDate(0, 0, -30))
	if err != nil {
		problem.Write(w, 500, "Load workspace analytics failed", err.Error())
		return
	}
	active, err := h.activeIssues(r, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load workspace analytics failed", err.Error())
		return
	}
	problem.JSON(w, 200, workspaceResponse{WorkspaceID: p.WorkspaceID, CompletedLast30Days: completed, ActiveIssues: active, Period: "Last 30 days"})
}

func (h Handler) completedLast30Days(r *http.Request, workspaceID string, since time.Time) ([]completedTeamCount, error) {
	rows, err := h.DB.Query(r.Context(), `
		select t.id::text, t.name, count(i.id)::int
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid and ws.category='completed' and i.completed_at >= $2
		group by t.id, t.name
		order by t.name asc`, workspaceID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []completedTeamCount{}
	for rows.Next() {
		var item completedTeamCount
		if err := rows.Scan(&item.TeamID, &item.TeamName, &item.CompletedCount); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h Handler) activeIssues(r *http.Request, workspaceID string) ([]activeTeamCount, error) {
	rows, err := h.DB.Query(r.Context(), `
		select t.id::text, t.name, count(i.id)::int
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid and ws.category in ('unstarted','started')
		group by t.id, t.name
		order by t.name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activeTeamCount{}
	for rows.Next() {
		var item activeTeamCount
		if err := rows.Scan(&item.TeamID, &item.TeamName, &item.ActiveCount); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
