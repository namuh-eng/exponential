package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

type microsoftTeamsConnectResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
	WorkspaceSlug    string `json:"workspaceSlug"`
}

type microsoftTeamsOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type microsoftTeamsInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	TenantID      string
	DisplayName   string
	Metadata      map[string]any
}

type microsoftTeamsIdentity struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AadObjectID string `json:"aadObjectId"`
	UserID      string `json:"userId"`
	Email       string `json:"email"`
}

type microsoftTeamsConversation struct {
	ID               string `json:"id"`
	ConversationType string `json:"conversationType"`
	TenantID         string `json:"tenantId"`
}

type microsoftTeamsChannelData struct {
	Tenant struct {
		ID string `json:"id"`
	} `json:"tenant"`
	Team struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"team"`
	Channel struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Membership  string `json:"membershipType"`
		ChannelType string `json:"channelType"`
	} `json:"channel"`
	MessageID string `json:"messageId"`
	EventType string `json:"eventType"`
}

type microsoftTeamsActivity struct {
	ID           string                     `json:"id"`
	Type         string                     `json:"type"`
	Text         string                     `json:"text"`
	Summary      string                     `json:"summary"`
	ReplyToID    string                     `json:"replyToId"`
	ServiceURL   string                     `json:"serviceUrl"`
	From         microsoftTeamsIdentity     `json:"from"`
	Conversation microsoftTeamsConversation `json:"conversation"`
	ChannelData  microsoftTeamsChannelData  `json:"channelData"`
	Value        map[string]any             `json:"value"`
}

type microsoftTeamsCommandContext struct {
	ActivityID    string
	WorkspaceID   string
	IntegrationID string
	TenantID      string
	TeamID        string
	ChannelID     string
	ThreadID      string
	MessageID     string
	Permalink     string
	ActorUserID   string
	MappedMember  bool
	TeamsUserID   string
	TeamsUserName string
}

type microsoftTeamsIssue struct {
	ID         string
	Identifier string
	Title      string
	TeamKey    string
	StateName  string
	Priority   string
}

type microsoftTeamsProject struct {
	ID   string
	Name string
	Slug string
}

func (h Handler) MicrosoftTeamsConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := microsoftOAuthConfig()
	if !ok || strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_BOT_SECRET")) == "" {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Microsoft Teams OAuth is not configured", "message": "Add AUTH_MICROSOFT_ID, AUTH_MICROSOFT_SECRET, and MICROSOFT_TEAMS_BOT_SECRET to enable Microsoft Teams installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Microsoft Teams authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Microsoft Teams authorization failed", err.Error())
		return
	}
	if err := h.saveMicrosoftTeamsOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Microsoft Teams authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, microsoftTeamsConnectResponse{AuthorizationURL: microsoftTeamsAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) MicrosoftTeamsDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "microsoft_teams"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Microsoft Teams failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) MicrosoftTeamsOAuthCallback(w http.ResponseWriter, r *http.Request) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	tenantID := firstNonEmpty(r.URL.Query().Get("tenant"), r.URL.Query().Get("tenant_id"))
	if teamsError := strings.TrimSpace(r.URL.Query().Get("error")); teamsError != "" {
		http.Redirect(w, r, microsoftTeamsRedirectURL("error", teamsError), http.StatusFound)
		return
	}
	if state == "" || strings.TrimSpace(tenantID) == "" {
		problem.Write(w, http.StatusBadRequest, "Microsoft Teams OAuth callback is missing state or tenant", "")
		return
	}
	install, err := h.findMicrosoftTeamsOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Microsoft Teams OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Microsoft Teams OAuth callback failed", err.Error())
		return
	}
	if err := h.completeMicrosoftTeamsInstall(r.Context(), install, strings.TrimSpace(tenantID)); err != nil {
		_ = h.recordMicrosoftTeamsInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusInternalServerError, "Microsoft Teams OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, microsoftTeamsRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) MicrosoftTeamsActivities(w http.ResponseWriter, r *http.Request) {
	activity, ok := readVerifiedMicrosoftTeamsActivity(w, r)
	if !ok {
		return
	}
	tenantID := microsoftTeamsTenantID(activity)
	if tenantID == "" {
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Install exponential in a Microsoft tenant before using Teams actions."))
		return
	}
	install, err := h.resolveMicrosoftTeamsInstall(r.Context(), tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Microsoft Teams is not connected to an exponential workspace."))
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Microsoft Teams integration failed", err.Error())
		return
	}
	if !microsoftTeamsStandardChannel(activity) {
		_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "unsupported_channel", "warning", "Private and shared Teams channels are not configurable yet.", map[string]any{"tenantId": tenantID, "channelId": microsoftTeamsChannelID(activity)})
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Private and shared Teams channels are not supported yet. Choose a standard Teams channel for exponential actions."))
		return
	}
	ctx := h.microsoftTeamsCommandContext(r.Context(), install, activity)
	command, remainder := microsoftTeamsCommand(activity.Text)
	switch command {
	case "create_issue":
		h.handleMicrosoftTeamsCreateIssue(w, r, install, ctx, remainder)
	case "create_project":
		h.handleMicrosoftTeamsCreateProject(w, r, install, ctx, remainder)
	case "ask":
		h.handleMicrosoftTeamsAsk(w, r, install, ctx, remainder)
	case "summarize_thread":
		h.handleMicrosoftTeamsSummarizeThread(w, r, install, ctx)
	default:
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Use `create issue <title>`, `create project <name>`, `ask <question>`, or `summarize thread`."))
	}
}

func readVerifiedMicrosoftTeamsActivity(w http.ResponseWriter, r *http.Request) (microsoftTeamsActivity, bool) {
	secret := strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_BOT_SECRET"))
	if secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Microsoft Teams bot secret is not configured", "")
		return microsoftTeamsActivity{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Microsoft Teams activity body could not be read", err.Error())
		return microsoftTeamsActivity{}, false
	}
	if !verifyMicrosoftTeamsSignature(secret, r.Header.Get("X-Microsoft-Teams-Timestamp"), r.Header.Get("X-Microsoft-Teams-Signature"), body, time.Now()) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Microsoft Teams signature", "")
		return microsoftTeamsActivity{}, false
	}
	var activity microsoftTeamsActivity
	if err := json.Unmarshal(body, &activity); err != nil {
		problem.Write(w, http.StatusBadRequest, "Microsoft Teams activity payload is invalid", err.Error())
		return microsoftTeamsActivity{}, false
	}
	return activity, true
}

func (h Handler) handleMicrosoftTeamsCreateIssue(w http.ResponseWriter, r *http.Request, install microsoftTeamsInstallRecord, ctx microsoftTeamsCommandContext, title string) {
	title = strings.TrimSpace(truncateSlackText(title, 500))
	if title == "" {
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Add a title: `create issue <summary>`."))
		return
	}
	team, err := h.discordAccessibleTeam(r.Context(), ctx.WorkspaceID, ctx.ActorUserID, "")
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("No permitted exponential team is available for this Teams action."))
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Microsoft Teams issue team failed", err.Error())
		return
	}
	issue, duplicated, err := h.createMicrosoftTeamsIssue(r.Context(), install, ctx, team, title)
	if err != nil {
		_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "issue_creation_failed", "error", safeSlackError(err), map[string]any{"teamsUserId": ctx.TeamsUserID})
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Unable to create this exponential issue."))
		return
	}
	verb := "Created"
	if duplicated {
		verb = "Already created"
	}
	_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "issue_created_from_teams", "info", "Microsoft Teams action created an issue.", map[string]any{"issueId": issue.ID, "identifier": issue.Identifier, "teamsUserId": ctx.TeamsUserID, "mappedMember": ctx.MappedMember})
	problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse(fmt.Sprintf("%s %s %s", verb, issue.Identifier, issue.Title)))
}

func (h Handler) handleMicrosoftTeamsCreateProject(w http.ResponseWriter, r *http.Request, install microsoftTeamsInstallRecord, ctx microsoftTeamsCommandContext, name string) {
	name = strings.TrimSpace(truncateSlackText(name, 255))
	if name == "" {
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Add a name: `create project <name>`."))
		return
	}
	project, duplicated, err := h.createMicrosoftTeamsProject(r.Context(), install, ctx, name)
	if err != nil {
		_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "project_creation_failed", "error", safeSlackError(err), map[string]any{"teamsUserId": ctx.TeamsUserID})
		problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse("Unable to create this exponential project."))
		return
	}
	verb := "Created"
	if duplicated {
		verb = "Already created"
	}
	_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "project_created_from_teams", "info", "Microsoft Teams action created a project.", map[string]any{"projectId": project.ID, "slug": project.Slug, "teamsUserId": ctx.TeamsUserID, "mappedMember": ctx.MappedMember, "sourceEventId": ctx.ActivityID})
	problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse(fmt.Sprintf("%s project %s", verb, project.Name)))
}

func (h Handler) handleMicrosoftTeamsAsk(w http.ResponseWriter, r *http.Request, install microsoftTeamsInstallRecord, ctx microsoftTeamsCommandContext, query string) {
	answer, err := h.microsoftTeamsWorkspaceAnswer(r.Context(), ctx.WorkspaceID, ctx.ActorUserID, query)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Answer Microsoft Teams workspace question failed", err.Error())
		return
	}
	_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "workspace_question_answered", "info", "Microsoft Teams action answered a workspace question.", map[string]any{"teamsUserId": ctx.TeamsUserID})
	problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse(answer))
}

func (h Handler) handleMicrosoftTeamsSummarizeThread(w http.ResponseWriter, r *http.Request, install microsoftTeamsInstallRecord, ctx microsoftTeamsCommandContext) {
	summary, err := h.microsoftTeamsThreadSummary(r.Context(), install, ctx)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Summarize Microsoft Teams thread failed", err.Error())
		return
	}
	_ = h.recordMicrosoftTeamsEvent(r.Context(), install, "thread_summary_posted", "info", "Microsoft Teams action summarized an exponential-linked thread.", map[string]any{"teamsUserId": ctx.TeamsUserID, "threadId": ctx.ThreadID})
	problem.JSON(w, http.StatusOK, microsoftTeamsTextResponse(summary))
}

func (h Handler) createMicrosoftTeamsIssue(ctx context.Context, install microsoftTeamsInstallRecord, command microsoftTeamsCommandContext, team slackIssueTeamOption, title string) (microsoftTeamsIssue, bool, error) {
	if command.ActivityID != "" {
		if issue, err := h.microsoftTeamsIssueForSource(ctx, install.IntegrationID, command.ActivityID); err == nil {
			return issue, true, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return microsoftTeamsIssue{}, false, err
		}
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "triage")
	if errors.Is(err, pgx.ErrNoRows) {
		stateID, err = slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	}
	if err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	var stateName string
	_ = tx.QueryRow(ctx, `select name from workflow_state where id=$1::uuid`, stateID).Scan(&stateName)
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := microsoftTeamsIssueDescriptionHTML("", command)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,'none')
		returning id::text`, nextNumber, identifier, title, description, team.ID, stateID, command.ActorUserID).Scan(&issueID); err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	history := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "microsoft_teams_message", "backlink": issueBacklink(team.Key, identifier), "microsoftTeams": microsoftTeamsHistoryMetadata(command)}
	historyRaw, _ := json.Marshal(history)
	actorName := ""
	if !command.MappedMember {
		actorName = "From Teams " + command.TeamsUserName
	}
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,$3,null,'created',$4::jsonb)`, issueID, command.ActorUserID, nullString(actorName), historyRaw); err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	if err := insertMicrosoftTeamsIssueLinkTx(ctx, tx, install, command, issueID); err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return microsoftTeamsIssue{}, false, err
	}
	return microsoftTeamsIssue{ID: issueID, Identifier: identifier, Title: title, TeamKey: team.Key, StateName: stateName, Priority: "none"}, false, nil
}

func (h Handler) createMicrosoftTeamsProject(ctx context.Context, install microsoftTeamsInstallRecord, command microsoftTeamsCommandContext, name string) (microsoftTeamsProject, bool, error) {
	if command.ActivityID != "" {
		if project, err := h.microsoftTeamsProjectForSource(ctx, install.IntegrationID, command.ActivityID); err == nil {
			return project, true, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return microsoftTeamsProject{}, false, err
		}
	}
	slug := microsoftTeamsProjectSlug(name)
	settings := map[string]any{"source": "microsoft_teams_message", "microsoftTeams": microsoftTeamsHistoryMetadata(command)}
	settingsRaw, _ := json.Marshal(settings)
	var project microsoftTeamsProject
	if err := h.DB.QueryRow(ctx, `insert into project (name, description, slug, status, priority, lead_id, workspace_id, settings) values ($1,'',$2,'planned','none',$3,$4::uuid,$5::jsonb) returning id::text,name,slug`, name, slug, command.ActorUserID, command.WorkspaceID, settingsRaw).Scan(&project.ID, &project.Name, &project.Slug); err != nil {
		if isMicrosoftTeamsUniqueViolation(err) {
			if existing, lookupErr := h.microsoftTeamsProjectBySlug(ctx, command.WorkspaceID, slug); lookupErr == nil {
				return existing, true, nil
			}
		}
		return microsoftTeamsProject{}, false, err
	}
	return project, false, nil
}

func (h Handler) microsoftTeamsIssueForSource(ctx context.Context, integrationID, sourceEventID string) (microsoftTeamsIssue, error) {
	var issue microsoftTeamsIssue
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,i.priority::text
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='microsoft_teams' and itl.source_event_id=$2
		limit 1`, integrationID, sourceEventID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Priority)
	return issue, err
}

func (h Handler) microsoftTeamsProjectForSource(ctx context.Context, integrationID, sourceEventID string) (microsoftTeamsProject, error) {
	var project microsoftTeamsProject
	err := h.DB.QueryRow(ctx, `
		select p.id::text,p.name,p.slug
		from provider_event pe
		join project p on p.id=(pe.payload->>'projectId')::uuid
		where pe.workspace_integration_id=$1::uuid and pe.provider='microsoft_teams' and pe.payload->>'sourceEventId'=$2 and pe.payload ? 'projectId' and pe.payload->>'projectId' <> ''
		limit 1`, integrationID, sourceEventID).Scan(&project.ID, &project.Name, &project.Slug)
	return project, err
}

func (h Handler) microsoftTeamsProjectBySlug(ctx context.Context, workspaceID, slug string) (microsoftTeamsProject, error) {
	var project microsoftTeamsProject
	err := h.DB.QueryRow(ctx, `select id::text,name,slug from project where workspace_id=$1::uuid and slug=$2 limit 1`, workspaceID, slug).Scan(&project.ID, &project.Name, &project.Slug)
	return project, err
}

func (h Handler) microsoftTeamsWorkspaceAnswer(ctx context.Context, workspaceID, userID, query string) (string, error) {
	var openIssues, activeProjects int
	if err := h.DB.QueryRow(ctx, `
		select count(*)
		from issue i
		join team t on t.id=i.team_id
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		where t.workspace_id=$1::uuid and i.archived_at is null and i.completed_at is null and i.canceled_at is null
			and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null)`, workspaceID, userID).Scan(&openIssues); err != nil {
		return "", err
	}
	if err := h.DB.QueryRow(ctx, `select count(*) from project where workspace_id=$1::uuid and completed_at is null and canceled_at is null`, workspaceID).Scan(&activeProjects); err != nil {
		return "", err
	}
	question := strings.TrimSpace(query)
	if question == "" {
		question = "workspace status"
	}
	return fmt.Sprintf("For `%s`: %d open issues and %d active projects are visible in exponential.", truncateSlackText(question, 80), openIssues, activeProjects), nil
}

func (h Handler) microsoftTeamsThreadSummary(ctx context.Context, install microsoftTeamsInstallRecord, command microsoftTeamsCommandContext) (string, error) {
	var identifier, title string
	err := h.DB.QueryRow(ctx, `
		select i.identifier,i.title
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='microsoft_teams' and itl.external_channel_id=$2 and itl.external_thread_ts=$3
		order by itl.created_at asc
		limit 1`, install.IntegrationID, command.ChannelID, command.ThreadID).Scan(&identifier, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		return "No exponential issue is linked to this Teams thread yet.", nil
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("This Teams thread is linked to %s %s.", identifier, truncateSlackText(title, 120)), nil
}

func (h Handler) microsoftTeamsCommandContext(ctx context.Context, install microsoftTeamsInstallRecord, activity microsoftTeamsActivity) microsoftTeamsCommandContext {
	teamsUserID := firstNonEmpty(activity.From.AadObjectID, activity.From.UserID, activity.From.ID, stringValue(activity.Value["userId"]))
	actorUserID, mapped := h.microsoftTeamsActorUserID(ctx, install, teamsUserID, activity.From.Email)
	if actorUserID == "" {
		actorUserID = install.ConnectedBy
	}
	return microsoftTeamsCommandContext{ActivityID: activity.ID, WorkspaceID: install.WorkspaceID, IntegrationID: install.IntegrationID, TenantID: install.TenantID, TeamID: microsoftTeamsTeamID(activity), ChannelID: microsoftTeamsChannelID(activity), ThreadID: firstNonEmpty(activity.ReplyToID, activity.ChannelData.MessageID, activity.ID, activity.Conversation.ID), MessageID: firstNonEmpty(activity.ChannelData.MessageID, activity.ID), Permalink: microsoftTeamsPermalink(activity), ActorUserID: actorUserID, MappedMember: mapped, TeamsUserID: teamsUserID, TeamsUserName: firstNonEmpty(activity.From.Name, teamsUserID, "unknown user")}
}

func (h Handler) microsoftTeamsActorUserID(ctx context.Context, install microsoftTeamsInstallRecord, teamsUserID, email string) (string, bool) {
	candidates := []string{}
	for _, key := range []string{"microsoftTeamsUserMap", "microsoftUserMap", "userMap"} {
		if mapped := stringValue(recordValue(install.Metadata[key])[teamsUserID]); mapped != "" {
			candidates = append(candidates, mapped)
		}
	}
	for _, accountID := range []string{teamsUserID, email} {
		if strings.TrimSpace(accountID) == "" {
			continue
		}
		var accountUserID string
		if err := h.DB.QueryRow(ctx, `select user_id from account where provider_id in ('microsoft','microsoft_teams') and account_id=$1 order by updated_at desc limit 1`, accountID).Scan(&accountUserID); err == nil && accountUserID != "" {
			candidates = append(candidates, accountUserID)
		}
	}
	for _, userID := range candidates {
		var found string
		err := h.DB.QueryRow(ctx, `select user_id from member where workspace_id=$1::uuid and user_id=$2 limit 1`, install.WorkspaceID, userID).Scan(&found)
		if err == nil && found != "" {
			return found, true
		}
	}
	return "", false
}

func (h Handler) resolveMicrosoftTeamsInstall(ctx context.Context, tenantID string) (microsoftTeamsInstallRecord, error) {
	var install microsoftTeamsInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `
		select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(external_id,''), coalesce(display_name,''), coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='microsoft_teams' and external_id=$1 and status in ('connected','degraded')
		limit 1`, tenantID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.TenantID, &install.DisplayName, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &install.Metadata)
	return install, nil
}

func (h Handler) saveMicrosoftTeamsOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{"oauthStateHash": hashMicrosoftTeamsSecret(state), "oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano), "oauthStartedAt": now.Format(time.RFC3339Nano)}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'microsoft_teams', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set
			status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findMicrosoftTeamsOAuthInstall(ctx context.Context, state string) (microsoftTeamsOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='microsoft_teams' and status='installing'`)
	if err != nil {
		return microsoftTeamsOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashMicrosoftTeamsSecret(state)
	for rows.Next() {
		var install microsoftTeamsOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return microsoftTeamsOAuthInstall{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return microsoftTeamsOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return microsoftTeamsOAuthInstall{}, err
	}
	return microsoftTeamsOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeMicrosoftTeamsInstall(ctx context.Context, install microsoftTeamsOAuthInstall, tenantID string) error {
	if tenantID == "" {
		return fmt.Errorf("Microsoft Teams OAuth response did not include a tenant ID")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	displayName := "Microsoft tenant " + tenantID
	metadata := map[string]any{"tenantId": tenantID, "tenantName": displayName, "installedBy": install.UserID, "supportedChannelTypes": []string{"standard"}}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5,
			connected_at=coalesce(connected_at, $6), last_event_at=$6, last_success_at=$6,
			last_failure_at=null, last_failure_message=null, token_expires_at=null,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6
		where id=$1::uuid`, install.ID, tenantID, displayName, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{
		"tenantId":     tenantID,
		"botSecretRef": "MICROSOFT_TEAMS_BOT_SECRET",
		"botToken":     strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_BOT_TOKEN")),
		"serviceUrl":   strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_SERVICE_URL")),
		"webhookUrl":   strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_WEBHOOK_URL")),
	}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'microsoft_teams', $2, $3::jsonb, $4, $5, $5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'microsoft_teams', 'oauth_connected', 'info', 'Microsoft Teams tenant connected.', $3::jsonb, $4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordMicrosoftTeamsInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid, $2::uuid, 'microsoft_teams', 'oauth_failed', 'error', $3, '{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) recordMicrosoftTeamsEvent(ctx context.Context, install microsoftTeamsInstallRecord, eventType, severity, message string, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	if _, ok := payload["sourceEventId"]; !ok {
		payload["sourceEventId"] = ""
	}
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'microsoft_teams',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func insertMicrosoftTeamsIssueLinkTx(ctx context.Context, tx pgx.Tx, install microsoftTeamsInstallRecord, command microsoftTeamsCommandContext, issueID string) error {
	_, err := tx.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'microsoft_teams',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9)
		on conflict do nothing`, install.WorkspaceID, install.IntegrationID, issueID, command.TeamID, command.ChannelID, command.ThreadID, command.MessageID, command.Permalink, nullString(command.ActivityID))
	return err
}

func microsoftOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_MICROSOFT_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_MICROSOFT_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func microsoftTeamsRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/microsoft-teams/oauth/callback"
}

func microsoftTeamsAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("redirect_uri", microsoftTeamsRedirectURI(appURL))
	values.Set("state", state)
	return "https://login.microsoftonline.com/common/adminconsent?" + values.Encode()
}

func microsoftTeamsRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("microsoft_teams", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func verifyMicrosoftTeamsSignature(secret string, timestamp string, signature string, body []byte, now time.Time) bool {
	if secret == "" || timestamp == "" || signature == "" {
		return false
	}
	requestTime, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		var unixSeconds int64
		if _, scanErr := fmt.Sscanf(timestamp, "%d", &unixSeconds); scanErr != nil {
			return false
		}
		requestTime = time.Unix(unixSeconds, 0)
	}
	if now.Sub(requestTime) > 5*time.Minute || requestTime.Sub(now) > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	expected := "v1=" + hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func microsoftTeamsTestSignature(secret string, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

func hashMicrosoftTeamsSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func microsoftTeamsTenantID(activity microsoftTeamsActivity) string {
	return firstNonEmpty(activity.ChannelData.Tenant.ID, activity.Conversation.TenantID, stringValue(activity.Value["tenantId"]))
}

func microsoftTeamsTeamID(activity microsoftTeamsActivity) string {
	return firstNonEmpty(activity.ChannelData.Team.ID, stringValue(activity.Value["teamId"]))
}

func microsoftTeamsChannelID(activity microsoftTeamsActivity) string {
	return firstNonEmpty(activity.ChannelData.Channel.ID, activity.Conversation.ID, stringValue(activity.Value["channelId"]))
}

func microsoftTeamsStandardChannel(activity microsoftTeamsActivity) bool {
	channelType := strings.ToLower(strings.TrimSpace(firstNonEmpty(activity.ChannelData.Channel.ChannelType, activity.ChannelData.Channel.Membership, stringValue(activity.Value["channelType"]))))
	return channelType == "" || channelType == "standard"
}

func microsoftTeamsPermalink(activity microsoftTeamsActivity) string {
	if link := strings.TrimSpace(stringValue(activity.Value["permalink"])); link != "" {
		return link
	}
	teamID := microsoftTeamsTeamID(activity)
	channelID := microsoftTeamsChannelID(activity)
	messageID := firstNonEmpty(activity.ChannelData.MessageID, activity.ID)
	if teamID == "" || channelID == "" || messageID == "" {
		return ""
	}
	values := url.Values{}
	values.Set("tenantId", microsoftTeamsTenantID(activity))
	values.Set("groupId", teamID)
	values.Set("parentMessageId", messageID)
	return "https://teams.microsoft.com/l/message/" + url.PathEscape(channelID) + "/" + url.PathEscape(messageID) + "?" + values.Encode()
}

func microsoftTeamsCommand(text string) (string, string) {
	cleaned := strings.TrimSpace(stripMicrosoftTeamsMentions(text))
	lower := strings.ToLower(cleaned)
	for _, prefix := range []struct{ Prefix, Command string }{
		{"create issue ", "create_issue"},
		{"issue ", "create_issue"},
		{"create project ", "create_project"},
		{"project ", "create_project"},
		{"ask ", "ask"},
		{"summarize thread", "summarize_thread"},
		{"summarise thread", "summarize_thread"},
	} {
		if strings.HasPrefix(lower, prefix.Prefix) {
			return prefix.Command, strings.TrimSpace(cleaned[len(prefix.Prefix):])
		}
		if lower == strings.TrimSpace(prefix.Prefix) {
			return prefix.Command, ""
		}
	}
	return "", cleaned
}

func stripMicrosoftTeamsMentions(text string) string {
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	for {
		start := strings.Index(strings.ToLower(text), "<at>")
		if start < 0 {
			break
		}
		end := strings.Index(strings.ToLower(text[start:]), "</at>")
		if end < 0 {
			break
		}
		text = strings.TrimSpace(text[:start] + " " + text[start+end+len("</at>"):])
	}
	return strings.Join(strings.Fields(html.UnescapeString(text)), " ")
}

func microsoftTeamsTextResponse(text string) map[string]any {
	return map[string]any{"type": "message", "text": text}
}

func microsoftTeamsIssueDescriptionHTML(description string, command microsoftTeamsCommandContext) string {
	parts := []string{}
	if strings.TrimSpace(description) != "" {
		parts = append(parts, sanitizehtml.RichText(description))
	}
	source := "Created from Microsoft Teams"
	if command.Permalink != "" {
		source = fmt.Sprintf(`<a href="%s">Created from Microsoft Teams</a>`, html.EscapeString(command.Permalink))
	}
	parts = append(parts, `<p>`+source+`</p>`)
	return strings.Join(parts, "\n")
}

func microsoftTeamsHistoryMetadata(command microsoftTeamsCommandContext) map[string]any {
	return map[string]any{"tenantId": command.TenantID, "teamId": command.TeamID, "channelId": command.ChannelID, "threadId": command.ThreadID, "messageId": command.MessageID, "activityId": command.ActivityID, "permalink": command.Permalink, "actorUserId": command.TeamsUserID, "mappedMember": command.MappedMember}
}

func microsoftTeamsProjectSlug(name string) string {
	base := strings.ToLower(strings.TrimSpace(name))
	builder := strings.Builder{}
	lastDash := false
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(builder.String(), "-")
	if out == "" {
		out = "teams-project"
	}
	if len(out) > 80 {
		out = strings.Trim(out[:80], "-")
	}
	return out
}

func isMicrosoftTeamsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
