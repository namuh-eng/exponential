package integrations

import (
	"context"
	"crypto/ed25519"
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
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

const (
	discordInteractionPing                 = 1
	discordInteractionApplicationCommand   = 2
	discordInteractionResponsePong         = 1
	discordInteractionResponseChannelMsg   = 4
	discordInteractionResponseEphemeral    = 64
	discordApplicationCommandOptionSubcmd  = 1
	discordApplicationCommandOptionString  = 3
	discordApplicationCommandOptionInteger = 4
)

type discordConnectResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
	WorkspaceSlug    string `json:"workspaceSlug"`
}

type discordOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type discordOAuthResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
	Guild       struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"guild"`
}

type discordInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	Metadata      map[string]any
}

type discordInteractionPayload struct {
	ID        string             `json:"id"`
	Type      int                `json:"type"`
	GuildID   string             `json:"guild_id"`
	ChannelID string             `json:"channel_id"`
	Member    discordMember      `json:"member"`
	User      discordUser        `json:"user"`
	Data      discordCommandData `json:"data"`
}

type discordMember struct {
	User discordUser `json:"user"`
}

type discordUser struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name"`
}

type discordCommandData struct {
	Name    string          `json:"name"`
	Options []discordOption `json:"options"`
}

type discordOption struct {
	Name    string          `json:"name"`
	Type    int             `json:"type"`
	Value   any             `json:"value"`
	Options []discordOption `json:"options"`
}

type discordCommandContext struct {
	InteractionID string
	WorkspaceID   string
	IntegrationID string
	GuildID       string
	ChannelID     string
	UserID        string
	DiscordUserID string
	DiscordName   string
}

type discordCommandIssue struct {
	ID         string
	Identifier string
	Title      string
	TeamKey    string
	StateName  string
	Priority   string
}

func (h Handler) DiscordConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := discordOAuthConfig()
	if !ok || strings.TrimSpace(os.Getenv("DISCORD_PUBLIC_KEY")) == "" {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Discord OAuth is not configured", "message": "Add AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, and DISCORD_PUBLIC_KEY to enable Discord installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Discord authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Discord authorization failed", err.Error())
		return
	}
	if err := h.saveDiscordOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Discord authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, discordConnectResponse{AuthorizationURL: discordAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) DiscordDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "discord"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Discord failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) DiscordOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	guildID := strings.TrimSpace(r.URL.Query().Get("guild_id"))
	if discordError := strings.TrimSpace(r.URL.Query().Get("error")); discordError != "" {
		http.Redirect(w, r, discordRedirectURL("error", discordError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Discord OAuth callback is missing code or state", "")
		return
	}
	clientID, clientSecret, ok := discordOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Discord OAuth is not configured", "")
		return
	}
	install, err := h.findDiscordOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Discord OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Discord OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeDiscordOAuth(r.Context(), http.DefaultClient, clientID, clientSecret, code, discordRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordDiscordInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Discord OAuth exchange failed", err.Error())
		return
	}
	if token.Guild.ID == "" {
		token.Guild.ID = guildID
	}
	if token.Guild.Name == "" {
		token.Guild.Name = "Discord guild " + token.Guild.ID
	}
	if err := h.completeDiscordInstall(r.Context(), install, token); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Discord OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, discordRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) DiscordInteractions(w http.ResponseWriter, r *http.Request) {
	payload, ok := readVerifiedDiscordInteraction(w, r)
	if !ok {
		return
	}
	if payload.Type == discordInteractionPing {
		problem.JSON(w, http.StatusOK, map[string]int{"type": discordInteractionResponsePong})
		return
	}
	if payload.Type != discordInteractionApplicationCommand {
		problem.JSON(w, http.StatusOK, discordMessageResponse("Unsupported Discord interaction.", true))
		return
	}
	guildID := strings.TrimSpace(payload.GuildID)
	if guildID == "" {
		problem.JSON(w, http.StatusOK, discordMessageResponse("Install exponential in a Discord server before using workspace commands.", true))
		return
	}
	install, err := h.resolveDiscordInstall(r.Context(), guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, discordMessageResponse("Discord is not connected to an exponential workspace.", true))
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Discord integration failed", err.Error())
		return
	}
	discordUser := discordUserFromInteraction(payload)
	actorUserID, member := h.discordActorUserID(r.Context(), install, discordUser.ID)
	if !member {
		_ = h.recordDiscordEvent(r.Context(), install, "account_link_required", "warning", "Discord command invoked by an unlinked user.", map[string]any{"discordUserId": discordUser.ID, "command": payload.Data.Name})
		problem.JSON(w, http.StatusOK, discordMessageResponse("Link your Discord account in exponential Settings → Connected accounts before using workspace commands.", true))
		return
	}
	ctx := discordCommandContext{InteractionID: payload.ID, WorkspaceID: install.WorkspaceID, IntegrationID: install.IntegrationID, GuildID: guildID, ChannelID: payload.ChannelID, UserID: actorUserID, DiscordUserID: discordUser.ID, DiscordName: firstNonEmpty(discordUser.GlobalName, discordUser.Username, discordUser.ID)}
	subcommand, options := discordSubcommand(payload.Data)
	switch subcommand {
	case "issue", "create":
		h.handleDiscordIssueCommand(w, r, install, ctx, options)
	case "search":
		h.handleDiscordSearchCommand(w, r, install, ctx, options)
	case "wrap":
		h.handleDiscordWrapCommand(w, r, install, ctx)
	default:
		problem.JSON(w, http.StatusOK, discordMessageResponse("Use `/exponential issue`, `/exponential search`, or `/exponential wrap`.", true))
	}
}

func readVerifiedDiscordInteraction(w http.ResponseWriter, r *http.Request) (discordInteractionPayload, bool) {
	publicKey := strings.TrimSpace(os.Getenv("DISCORD_PUBLIC_KEY"))
	if publicKey == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Discord public key is not configured", "")
		return discordInteractionPayload{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Discord interaction body could not be read", err.Error())
		return discordInteractionPayload{}, false
	}
	if !verifyDiscordSignature(publicKey, r.Header.Get("X-Signature-Timestamp"), r.Header.Get("X-Signature-Ed25519"), body, time.Now()) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Discord signature", "")
		return discordInteractionPayload{}, false
	}
	var payload discordInteractionPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		problem.Write(w, http.StatusBadRequest, "Discord interaction payload is invalid", err.Error())
		return discordInteractionPayload{}, false
	}
	return payload, true
}

func (h Handler) handleDiscordIssueCommand(w http.ResponseWriter, r *http.Request, install discordInstallRecord, ctx discordCommandContext, options []discordOption) {
	title := truncateSlackText(firstNonEmpty(discordOptionString(options, "title"), discordOptionString(options, "text")), 500)
	if title == "" {
		problem.JSON(w, http.StatusOK, discordMessageResponse("Add a title: `/exponential issue title:<summary>`.", true))
		return
	}
	team, err := h.discordAccessibleTeam(r.Context(), ctx.WorkspaceID, ctx.UserID, discordOptionString(options, "team"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, discordMessageResponse("No permitted exponential team is available for this Discord command.", true))
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Discord team failed", err.Error())
		return
	}
	issue, duplicated, err := h.createDiscordIssue(r.Context(), install, ctx, team, discordIssueCreateInput{
		Title:       title,
		Description: discordOptionString(options, "description"),
		Priority:    firstNonEmpty(discordOptionString(options, "priority"), "none"),
		SourceURL:   firstNonEmpty(discordOptionString(options, "message_link"), discordOptionString(options, "url")),
	})
	if err != nil {
		_ = h.recordDiscordEvent(r.Context(), install, "issue_creation_failed", "error", safeSlackError(err), map[string]any{"discordUserId": ctx.DiscordUserID})
		problem.JSON(w, http.StatusOK, discordMessageResponse("Unable to create this exponential issue.", true))
		return
	}
	verb := "Created"
	if duplicated {
		verb = "Already created"
	}
	_ = h.recordDiscordEvent(r.Context(), install, "issue_created_from_discord", "info", "Discord slash command created an issue.", map[string]any{"issueId": issue.ID, "identifier": issue.Identifier, "discordUserId": ctx.DiscordUserID})
	problem.JSON(w, http.StatusOK, discordIssueCardResponse(verb, issue, false))
}

func (h Handler) handleDiscordSearchCommand(w http.ResponseWriter, r *http.Request, install discordInstallRecord, ctx discordCommandContext, options []discordOption) {
	query := strings.TrimSpace(firstNonEmpty(discordOptionString(options, "query"), discordOptionString(options, "text")))
	if query == "" {
		problem.JSON(w, http.StatusOK, discordMessageResponse("Add a search query: `/exponential search query:<text>`.", true))
		return
	}
	issue, err := h.searchDiscordIssue(r.Context(), ctx.WorkspaceID, ctx.UserID, query)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, discordMessageResponse("No permitted issue matched your search.", true))
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search Discord issues failed", err.Error())
		return
	}
	_ = h.insertDiscordIssueLink(r.Context(), install, ctx, issue.ID, discordInteractionURL(ctx))
	_ = h.recordDiscordEvent(r.Context(), install, "issue_card_posted", "info", "Discord search posted an issue card.", map[string]any{"issueId": issue.ID, "identifier": issue.Identifier, "query": query})
	problem.JSON(w, http.StatusOK, discordIssueCardResponse("Found", issue, false))
}

func (h Handler) handleDiscordWrapCommand(w http.ResponseWriter, r *http.Request, install discordInstallRecord, ctx discordCommandContext) {
	wrap, err := h.discordUserActivityWrap(r.Context(), ctx.WorkspaceID, ctx.UserID, time.Now().UTC().Add(-24*time.Hour))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Build Discord wrap failed", err.Error())
		return
	}
	_ = h.recordDiscordEvent(r.Context(), install, "wrap_posted", "info", "Discord wrap summarized user activity.", map[string]any{"discordUserId": ctx.DiscordUserID})
	problem.JSON(w, http.StatusOK, discordMessageResponse(wrap, true))
}

type discordIssueCreateInput struct {
	Title       string
	Description string
	Priority    string
	SourceURL   string
}

func (h Handler) createDiscordIssue(ctx context.Context, install discordInstallRecord, command discordCommandContext, team slackIssueTeamOption, input discordIssueCreateInput) (discordCommandIssue, bool, error) {
	if command.InteractionID != "" {
		if issue, err := h.discordIssueForSource(ctx, install.IntegrationID, command.InteractionID); err == nil {
			return issue, true, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return discordCommandIssue{}, false, err
		}
	}
	if !validSlackPriority(input.Priority) {
		input.Priority = "none"
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return discordCommandIssue{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "triage")
	if errors.Is(err, pgx.ErrNoRows) {
		stateID, err = slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	}
	if err != nil {
		return discordCommandIssue{}, false, err
	}
	var stateName string
	_ = tx.QueryRow(ctx, `select name from workflow_state where id=$1::uuid`, stateID).Scan(&stateName)
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return discordCommandIssue{}, false, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := discordIssueDescriptionHTML(input.Description, firstNonEmpty(input.SourceURL, discordInteractionURL(command)))
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8)
		returning id::text`, nextNumber, identifier, strings.TrimSpace(input.Title), description, team.ID, stateID, command.UserID, input.Priority).Scan(&issueID); err != nil {
		return discordCommandIssue{}, false, err
	}
	history := map[string]any{"identifier": identifier, "title": strings.TrimSpace(input.Title), "teamId": team.ID, "source": "discord_command", "backlink": issueBacklink(team.Key, identifier), "discord": map[string]any{"guildId": command.GuildID, "channelId": command.ChannelID, "interactionId": command.InteractionID, "actorUserId": command.DiscordUserID}}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,$3,null,'created',$4::jsonb)`, issueID, command.UserID, nullString(command.DiscordName), historyRaw); err != nil {
		return discordCommandIssue{}, false, err
	}
	if err := insertDiscordIssueLinkTx(ctx, tx, install, command, issueID, firstNonEmpty(input.SourceURL, discordInteractionURL(command))); err != nil {
		return discordCommandIssue{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return discordCommandIssue{}, false, err
	}
	return discordCommandIssue{ID: issueID, Identifier: identifier, Title: input.Title, TeamKey: team.Key, StateName: stateName, Priority: input.Priority}, false, nil
}

func (h Handler) discordIssueForSource(ctx context.Context, integrationID, sourceEventID string) (discordCommandIssue, error) {
	var issue discordCommandIssue
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,i.priority::text
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='discord' and itl.source_event_id=$2
		limit 1`, integrationID, sourceEventID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Priority)
	return issue, err
}

func (h Handler) searchDiscordIssue(ctx context.Context, workspaceID, userID, query string) (discordCommandIssue, error) {
	pattern := "%" + strings.ReplaceAll(strings.TrimSpace(query), "%", "") + "%"
	var issue discordCommandIssue
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,i.priority::text
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		where t.workspace_id=$1::uuid
			and i.archived_at is null
			and t.deleted_at is null
			and t.retired_at is null
			and (i.identifier ilike $3 or i.title ilike $3)
			and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null)
		order by case when i.identifier ilike $4 then 0 else 1 end, i.updated_at desc
		limit 1`, workspaceID, userID, pattern, strings.TrimSpace(query)+"%").Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Priority)
	return issue, err
}

func (h Handler) discordUserActivityWrap(ctx context.Context, workspaceID, userID string, since time.Time) (string, error) {
	rows, err := h.DB.Query(ctx, `
		select i.identifier,i.title,ws.category::text,i.created_at,i.updated_at,i.completed_at
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		where t.workspace_id=$1::uuid
			and i.archived_at is null
			and (i.creator_id=$2 or i.assignee_id=$2)
			and (i.created_at >= $3 or i.updated_at >= $3 or i.completed_at >= $3 or ws.category='started')
			and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null)
		order by i.updated_at desc
		limit 10`, workspaceID, userID, since)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	started, completed, updated := 0, 0, 0
	lines := []string{}
	for rows.Next() {
		var identifier, title, category string
		var createdAt, updatedAt time.Time
		var completedAt *time.Time
		if err := rows.Scan(&identifier, &title, &category, &createdAt, &updatedAt, &completedAt); err != nil {
			return "", err
		}
		if category == "started" {
			started++
		}
		if completedAt != nil && completedAt.After(since) {
			completed++
		}
		if updatedAt.After(since) && createdAt.Before(since) && (completedAt == nil || completedAt.Before(since)) {
			updated++
		}
		lines = append(lines, fmt.Sprintf("- %s %s", identifier, truncateSlackText(title, 80)))
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "No issue activity in the last 24 hours.", nil
	}
	return fmt.Sprintf("Last 24 hours: %d started, %d completed, %d updated.\n%s", started, completed, updated, strings.Join(lines, "\n")), nil
}

func (h Handler) discordAccessibleTeam(ctx context.Context, workspaceID, userID, requested string) (slackIssueTeamOption, error) {
	requested = strings.TrimSpace(requested)
	var team slackIssueTeamOption
	var raw []byte
	args := []any{workspaceID, userID}
	whereRequested := ""
	if requested != "" {
		whereRequested = "and (lower(t.key)=lower($3) or t.id::text=$3)"
		args = append(args, requested)
	}
	err := h.DB.QueryRow(ctx, `
		select t.id::text,t.key,t.name,coalesce(t.settings,'{}'::jsonb),coalesce(t.triage_enabled,true)
		from team t
		join member m on m.workspace_id=t.workspace_id and m.user_id=$2
		left join team_member tm on tm.team_id=t.id and tm.user_id=$2
		where t.workspace_id=$1::uuid
			and t.deleted_at is null
			and t.retired_at is null
			`+whereRequested+`
			and ((coalesce(t.is_private,false)=false and m.role <> 'guest') or tm.user_id is not null)
		order by t.key asc
		limit 1`, args...).Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled)
	if err != nil {
		return team, err
	}
	team.Settings = readJSONRecord(raw)
	return team, nil
}

func (h Handler) discordActorUserID(ctx context.Context, install discordInstallRecord, discordUserID string) (string, bool) {
	candidates := []string{}
	for _, key := range []string{"discordUserMap", "userMap"} {
		if mapped := stringValue(recordValue(install.Metadata[key])[discordUserID]); mapped != "" {
			candidates = append(candidates, mapped)
		}
	}
	var accountUserID string
	if err := h.DB.QueryRow(ctx, `select user_id from account where provider_id='discord' and account_id=$1 order by updated_at desc limit 1`, discordUserID).Scan(&accountUserID); err == nil && accountUserID != "" {
		candidates = append(candidates, accountUserID)
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

func (h Handler) resolveDiscordInstall(ctx context.Context, guildID string) (discordInstallRecord, error) {
	var install discordInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `
		select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='discord' and external_id=$1 and status in ('connected','degraded')
		limit 1`, guildID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &install.Metadata)
	return install, nil
}

func (h Handler) saveDiscordOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{"oauthStateHash": hashDiscordSecret(state), "oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano), "oauthStartedAt": now.Format(time.RFC3339Nano)}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'discord', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set
			status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findDiscordOAuthInstall(ctx context.Context, state string) (discordOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='discord' and status='installing'`)
	if err != nil {
		return discordOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashDiscordSecret(state)
	for rows.Next() {
		var install discordOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return discordOAuthInstall{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return discordOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return discordOAuthInstall{}, err
	}
	return discordOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeDiscordInstall(ctx context.Context, install discordOAuthInstall, token discordOAuthResponse) error {
	if token.Guild.ID == "" {
		return fmt.Errorf("Discord OAuth response did not include a guild ID")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	metadata := map[string]any{"guildId": token.Guild.ID, "guildName": token.Guild.Name, "scopes": strings.Fields(token.Scope), "installedBy": install.UserID}
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
		where id=$1::uuid`, install.ID, token.Guild.ID, token.Guild.Name, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{"botToken": strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN")), "guildId": token.Guild.ID, "accessToken": token.AccessToken, "tokenType": token.TokenType, "scopes": strings.Fields(token.Scope)}
	credentialRaw, err := encryptedProviderCredentialJSON(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'discord', $2, $3::jsonb, $4, $5, $5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'discord', 'oauth_connected', 'info', 'Discord guild connected.', $3::jsonb, $4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordDiscordInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid, $2::uuid, 'discord', 'oauth_failed', 'error', $3, '{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) recordDiscordEvent(ctx context.Context, install discordInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'discord',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func (h Handler) insertDiscordIssueLink(ctx context.Context, install discordInstallRecord, command discordCommandContext, issueID string, permalink string) error {
	_, err := h.DB.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'discord',$3::uuid,$4,$5,$6,$7,$8,'outbound',$9)
		on conflict do nothing`, install.WorkspaceID, install.IntegrationID, issueID, command.GuildID, command.ChannelID, firstNonEmpty(command.ChannelID, command.InteractionID), firstNonEmpty(command.InteractionID, command.ChannelID), permalink, nullString(command.InteractionID))
	return err
}

func insertDiscordIssueLinkTx(ctx context.Context, tx pgx.Tx, install discordInstallRecord, command discordCommandContext, issueID string, permalink string) error {
	_, err := tx.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'discord',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9)
		on conflict do nothing`, install.WorkspaceID, install.IntegrationID, issueID, command.GuildID, command.ChannelID, firstNonEmpty(command.ChannelID, command.InteractionID), firstNonEmpty(command.InteractionID, command.ChannelID), permalink, nullString(command.InteractionID))
	return err
}

func discordOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_DISCORD_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_DISCORD_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func discordRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/discord/oauth/callback"
}

func discordAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("scope", "bot applications.commands")
	values.Set("permissions", "0")
	values.Set("response_type", "code")
	values.Set("redirect_uri", discordRedirectURI(appURL))
	values.Set("state", state)
	return "https://discord.com/oauth2/authorize?" + values.Encode()
}

func discordRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("discord", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func discordAPIBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("DISCORD_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://discord.com/api/v10"
}

func exchangeDiscordOAuth(ctx context.Context, client *http.Client, clientID, clientSecret, code string, redirectURI string) (discordOAuthResponse, error) {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, discordAPIBaseURL()+"/oauth2/token", strings.NewReader(values.Encode()))
	if err != nil {
		return discordOAuthResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return discordOAuthResponse{}, err
	}
	defer resp.Body.Close()
	var token discordOAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return discordOAuthResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return discordOAuthResponse{}, fmt.Errorf("Discord OAuth returned HTTP %d", resp.StatusCode)
	}
	return token, nil
}

func verifyDiscordSignature(publicKeyHex string, timestamp string, signatureHex string, body []byte, now time.Time) bool {
	if publicKeyHex == "" || timestamp == "" || signatureHex == "" {
		return false
	}
	publicKey, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return false
	}
	signature, err := hex.DecodeString(signatureHex)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return false
	}
	requestTime, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		if unixSeconds, parseErr := parseDiscordUnixTimestamp(timestamp); parseErr == nil {
			requestTime = time.Unix(unixSeconds, 0)
		} else {
			return false
		}
	}
	if now.Sub(requestTime) > 5*time.Minute || requestTime.Sub(now) > 5*time.Minute {
		return false
	}
	message := append([]byte(timestamp), body...)
	return ed25519.Verify(ed25519.PublicKey(publicKey), message, signature)
}

func parseDiscordUnixTimestamp(value string) (int64, error) {
	var seconds int64
	_, err := fmt.Sscanf(value, "%d", &seconds)
	return seconds, err
}

func hashDiscordSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func discordSubcommand(data discordCommandData) (string, []discordOption) {
	name := strings.ToLower(strings.TrimSpace(data.Name))
	for _, option := range data.Options {
		if option.Type == discordApplicationCommandOptionSubcmd {
			return strings.ToLower(strings.TrimSpace(option.Name)), option.Options
		}
	}
	return name, data.Options
}

func discordOptionString(options []discordOption, name string) string {
	for _, option := range options {
		if strings.EqualFold(option.Name, name) {
			switch typed := option.Value.(type) {
			case string:
				return strings.TrimSpace(typed)
			case float64:
				return strings.TrimSpace(fmt.Sprintf("%.0f", typed))
			case nil:
				return ""
			default:
				return strings.TrimSpace(fmt.Sprintf("%v", typed))
			}
		}
	}
	return ""
}

func discordUserFromInteraction(payload discordInteractionPayload) discordUser {
	if payload.Member.User.ID != "" {
		return payload.Member.User
	}
	return payload.User
}

func discordMessageResponse(content string, ephemeral bool) map[string]any {
	data := map[string]any{"content": truncateDiscordContent(content)}
	if ephemeral {
		data["flags"] = discordInteractionResponseEphemeral
	}
	return map[string]any{"type": discordInteractionResponseChannelMsg, "data": data}
}

func discordIssueCardResponse(prefix string, issue discordCommandIssue, ephemeral bool) map[string]any {
	content := fmt.Sprintf("%s **%s** — %s\n%s", prefix, issue.Identifier, issue.Title, issueBacklink(issue.TeamKey, issue.Identifier))
	fields := []map[string]any{{"name": "Status", "value": firstNonEmpty(issue.StateName, "Unknown"), "inline": true}, {"name": "Priority", "value": issue.Priority, "inline": true}}
	data := map[string]any{"content": truncateDiscordContent(content), "embeds": []map[string]any{{"title": issue.Identifier + " " + issue.Title, "url": issueBacklink(issue.TeamKey, issue.Identifier), "fields": fields}}}
	if ephemeral {
		data["flags"] = discordInteractionResponseEphemeral
	}
	return map[string]any{"type": discordInteractionResponseChannelMsg, "data": data}
}

func truncateDiscordContent(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= 1900 {
		return string(runes)
	}
	return string(runes[:1897]) + "..."
}

func discordInteractionURL(command discordCommandContext) string {
	if command.GuildID == "" || command.ChannelID == "" || command.InteractionID == "" {
		return ""
	}
	return "https://discord.com/channels/" + url.PathEscape(command.GuildID) + "/" + url.PathEscape(command.ChannelID) + "/" + url.PathEscape(command.InteractionID)
}

func discordIssueDescriptionHTML(description string, sourceURL string) string {
	description = strings.TrimSpace(description)
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + strings.ReplaceAll(html.EscapeString(description), "\n", "<br>") + "</p>"
	}
	if sourceURL == "" {
		return description
	}
	link := `<p><a href="` + html.EscapeString(sourceURL) + `">View source in Discord</a></p>`
	return sanitizehtml.RichText(description + link)
}

func discordConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
