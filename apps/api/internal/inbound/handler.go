package inbound

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type inboundPayload struct {
	Recipient string `json:"recipient"`
	To        string `json:"to"`
	From      string `json:"from"`
	Sender    string `json:"sender"`
	Subject   string `json:"subject"`
	Text      string `json:"text"`
	HTML      string `json:"html"`
}

type recipient struct {
	TeamKey       string
	WorkspaceSlug string
}

type teamRecord struct {
	ID            string
	Key           string
	WorkspaceID   string
	Settings      []byte
	WorkspaceSlug string
}

type issueResponse struct {
	Issue map[string]any `json:"issue"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/team-email", h.TeamEmail)
	return r
}

func (h Handler) TeamEmail(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		problem.Write(w, 401, "Unauthorized", "")
		return
	}
	var input inboundPayload
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	rec := parseRecipient(firstNonEmpty(input.Recipient, input.To))
	if rec == nil {
		problem.Write(w, 404, "Unknown inbound email recipient", "")
		return
	}
	team, err := h.findTeam(r.Context(), *rec)
	if err != nil {
		problem.Write(w, 404, "Unknown inbound email recipient", "")
		return
	}
	if !emailEnabled(team.Settings) {
		problem.Write(w, 403, "Inbound email is disabled for this team", "")
		return
	}
	stateID, err := h.defaultBacklogState(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 400, "No default workflow state found", "")
		return
	}
	creatorID, err := h.workspaceCreator(r.Context(), team.WorkspaceID)
	if err != nil {
		problem.Write(w, 400, "No workspace member can own inbound issue creation", "")
		return
	}
	number, err := h.nextIssueNumber(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Create inbound issue failed", err.Error())
		return
	}
	subject := firstNonEmpty(input.Subject, "No subject")
	description := normalizeDescription(firstNonEmpty(input.HTML, input.Text))
	sender := firstNonEmpty(input.From, input.Sender)
	issue, err := h.createIssue(r.Context(), team, number, subject, description, sender, firstNonEmpty(input.Recipient, input.To), creatorID, stateID)
	if err != nil {
		problem.Write(w, 500, "Create inbound issue failed", err.Error())
		return
	}
	problem.JSON(w, 201, issueResponse{Issue: issue})
}

func authorized(r *http.Request) bool {
	secret := os.Getenv("INBOUND_EMAIL_WEBHOOK_SECRET")
	if secret == "" {
		return os.Getenv("NODE_ENV") != "production"
	}
	return r.Header.Get("x-inbound-email-secret") == secret
}

func parseRecipient(value string) *recipient {
	normalized := strings.ToLower(strings.TrimSpace(value))
	parts := strings.Split(normalized, "@")
	if len(parts) != 2 || parts[1] != "team.linear.app" {
		return nil
	}
	local := strings.Split(parts[0], ".")
	if local[0] == "" {
		return nil
	}
	rec := &recipient{TeamKey: strings.ToUpper(local[0])}
	if len(local) > 1 {
		rec.WorkspaceSlug = strings.Join(local[1:], ".")
	}
	return rec
}

func (h Handler) findTeam(ctx context.Context, rec recipient) (teamRecord, error) {
	var team teamRecord
	var err error
	if rec.WorkspaceSlug != "" {
		err = h.DB.QueryRow(ctx, `select t.id::text,t.key,t.workspace_id::text,coalesce(t.settings,'{}'::jsonb),w.url_slug from team t join workspace w on w.id=t.workspace_id where t.key=$1 and w.url_slug=$2 limit 1`, rec.TeamKey, rec.WorkspaceSlug).Scan(&team.ID, &team.Key, &team.WorkspaceID, &team.Settings, &team.WorkspaceSlug)
	} else {
		err = h.DB.QueryRow(ctx, `select t.id::text,t.key,t.workspace_id::text,coalesce(t.settings,'{}'::jsonb),w.url_slug from team t join workspace w on w.id=t.workspace_id where t.key=$1 limit 1`, rec.TeamKey).Scan(&team.ID, &team.Key, &team.WorkspaceID, &team.Settings, &team.WorkspaceSlug)
	}
	return team, err
}

func emailEnabled(raw []byte) bool {
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	enabled, _ := settings["emailEnabled"].(bool)
	return enabled
}

func (h Handler) defaultBacklogState(ctx context.Context, teamID string) (string, error) {
	var id string
	err := h.DB.QueryRow(ctx, `select id::text from workflow_state where team_id=$1::uuid and category='backlog' order by is_default desc, position asc limit 1`, teamID).Scan(&id)
	return id, err
}
func (h Handler) workspaceCreator(ctx context.Context, workspaceID string) (string, error) {
	var id string
	err := h.DB.QueryRow(ctx, `select user_id from member where workspace_id=$1::uuid limit 1`, workspaceID).Scan(&id)
	return id, err
}
func (h Handler) nextIssueNumber(ctx context.Context, teamID string) (int32, error) {
	var max int32
	err := h.DB.QueryRow(ctx, `select coalesce(max(number),0)::int from issue where team_id=$1::uuid`, teamID).Scan(&max)
	return max + 1, err
}

func (h Handler) createIssue(ctx context.Context, team teamRecord, number int32, title, description, sender, recipient, creatorID, stateID string) (map[string]any, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	identifier := fmt.Sprintf("%s-%d", team.Key, number)
	var id string
	err = tx.QueryRow(ctx, `insert into issue (number, identifier, title, description, team_id, state_id, creator_id, priority) values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,'none') returning id::text`, number, identifier, title, description, team.ID, stateID, creatorID).Scan(&id)
	if err != nil {
		return nil, err
	}
	metadata := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "inbound_email", "recipient": recipient, "sender": nullable(sender)}
	metadataJSON, _ := json.Marshal(metadata)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id, actor_id, actor_name, actor_email, event_type, metadata) values ($1::uuid,$2,$3,$3,'created',$4::jsonb)`, id, creatorID, nullable(sender), metadataJSON); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "number": number, "identifier": identifier, "title": title, "description": description, "team_id": team.ID, "state_id": stateID, "creator_id": creatorID, "priority": "none"}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
func normalizeDescription(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "<") {
		return value
	}
	return "<p>" + htmlEscaper.Replace(value) + "</p>"
}

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
var _ = regexp.MustCompile
