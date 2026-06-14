package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

type slackMessageEvent struct {
	Type     string `json:"type"`
	Subtype  string `json:"subtype"`
	Channel  string `json:"channel"`
	TS       string `json:"ts"`
	ThreadTS string `json:"thread_ts"`
	Text     string `json:"text"`
	User     string `json:"user"`
	BotID    string `json:"bot_id"`
}

type slackLinkSharedEvent struct {
	Type      string `json:"type"`
	Channel   string `json:"channel"`
	MessageTS string `json:"message_ts"`
	Links     []struct {
		URL string `json:"url"`
	} `json:"links"`
}

type slackSyncedComment struct {
	ID        string            `json:"id"`
	Body      string            `json:"body"`
	IssueID   string            `json:"issue_id"`
	UserID    string            `json:"user_id"`
	User      map[string]string `json:"user"`
	OwnedByMe bool              `json:"owned_by_me"`
	CanEdit   bool              `json:"can_edit"`
	CanDelete bool              `json:"can_delete"`
	Reactions []any             `json:"reactions"`
	CreatedAt string            `json:"created_at"`
	UpdatedAt string            `json:"updated_at"`
}

type slackUnfurlAttachment struct {
	Title     string `json:"title"`
	TitleLink string `json:"title_link,omitempty"`
	Text      string `json:"text"`
	Color     string `json:"color,omitempty"`
}

var slackIssueURLPattern = regexp.MustCompile(`(?i)/issue/([A-Z][A-Z0-9]*-\d+)(?:[/?#]|$)`)

func (h Handler) handleSlackEvent(ctx context.Context, install slackInstallRecord, envelope map[string]any) error {
	event := recordValue(envelope["event"])
	if event == nil {
		return h.recordSlackIssueEvent(ctx, install, "webhook_received", "info", "Slack event received.", redactedSlackEventPayload(envelope))
	}
	switch stringValue(event["type"]) {
	case "message":
		return h.handleSlackMessageEvent(ctx, install, envelope, event)
	case "link_shared":
		return h.handleSlackLinkSharedEvent(ctx, install, event)
	default:
		return h.recordSlackIssueEvent(ctx, install, "webhook_received", "info", "Slack event received.", redactedSlackEventPayload(envelope))
	}
}

func (h Handler) handleSlackMessageEvent(ctx context.Context, install slackInstallRecord, envelope map[string]any, event map[string]any) error {
	message := slackMessageFromEvent(event)
	if !slackMessageShouldSync(message, stringValue(install.Metadata["botUserId"])) {
		return h.recordSlackIssueEvent(ctx, install, "webhook_ignored", "info", "Slack message event ignored.", map[string]any{"type": message.Type, "subtype": message.Subtype})
	}
	issueID, err := h.linkedSlackIssue(ctx, install, message.Channel, message.ThreadTS)
	if errors.Is(err, pgx.ErrNoRows) {
		return h.recordSlackIssueEvent(ctx, install, "thread_reply_unlinked", "info", "Slack reply did not match a linked issue thread.", map[string]any{"channel": message.Channel, "threadTs": message.ThreadTS})
	}
	if err != nil {
		return err
	}
	actorID, member := h.slackActorUserID(ctx, install, message.User)
	if !member {
		actorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return err
		}
	}
	body := slackReplyCommentBody(message, member)
	if body == "" {
		return h.recordSlackIssueEvent(ctx, install, "thread_reply_ignored", "info", "Slack reply was empty.", map[string]any{"channel": message.Channel, "messageTs": message.TS})
	}
	eventID := stringValue(envelope["event_id"])
	permalink := slackAppRedirect(stringValue(envelope["team_id"]), message.Channel, message.TS)
	inserted, err := h.insertSlackReplyComment(ctx, install, issueID, actorID, body, message, eventID, permalink)
	if err != nil {
		return err
	}
	if !inserted {
		return h.recordSlackIssueEvent(ctx, install, "thread_reply_duplicate", "info", "Slack reply was already synced.", map[string]any{"messageTs": message.TS})
	}
	return h.recordSlackIssueEvent(ctx, install, "thread_reply_synced", "info", "Slack reply synced to an issue comment.", map[string]any{"issueId": issueID, "messageTs": message.TS})
}

func (h Handler) handleSlackLinkSharedEvent(ctx context.Context, install slackInstallRecord, event map[string]any) error {
	shared := slackLinkSharedFromEvent(event)
	if shared.Channel == "" || shared.MessageTS == "" || len(shared.Links) == 0 {
		return h.recordSlackIssueEvent(ctx, install, "unfurl_ignored", "info", "Slack link_shared event did not include unfurlable links.", map[string]any{"channel": shared.Channel})
	}
	unfurls := map[string]slackUnfurlAttachment{}
	for _, link := range shared.Links {
		linkURL := strings.TrimSpace(link.URL)
		if linkURL == "" || !isConfiguredAppLink(linkURL) {
			continue
		}
		unfurls[linkURL] = h.slackUnfurlForURL(ctx, install.WorkspaceID, linkURL)
	}
	if len(unfurls) == 0 {
		return nil
	}
	payload := map[string]any{
		"type":       "unfurl",
		"channel":    shared.Channel,
		"message_ts": shared.MessageTS,
		"unfurls":    unfurls,
	}
	raw, _ := json.Marshal(payload)
	if _, err := h.DB.Exec(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		values ($1::uuid,$2::uuid,'slack','outbound_delivery','queued',$3::jsonb,now(),now())`, install.WorkspaceID, install.IntegrationID, raw); err != nil {
		return err
	}
	return h.recordSlackIssueEvent(ctx, install, "unfurl_queued", "info", "Slack link unfurl queued.", map[string]any{"linkCount": len(unfurls)})
}

func slackMessageFromEvent(event map[string]any) slackMessageEvent {
	return slackMessageEvent{
		Type:     stringValue(event["type"]),
		Subtype:  stringValue(event["subtype"]),
		Channel:  stringValue(event["channel"]),
		TS:       stringValue(event["ts"]),
		ThreadTS: stringValue(event["thread_ts"]),
		Text:     stringValue(event["text"]),
		User:     stringValue(event["user"]),
		BotID:    stringValue(event["bot_id"]),
	}
}

func slackLinkSharedFromEvent(event map[string]any) slackLinkSharedEvent {
	var shared slackLinkSharedEvent
	raw, _ := json.Marshal(event)
	_ = json.Unmarshal(raw, &shared)
	return shared
}

func slackMessageShouldSync(message slackMessageEvent, botUserID string) bool {
	if message.Type != "message" || message.Channel == "" || message.TS == "" || message.ThreadTS == "" {
		return false
	}
	if message.ThreadTS == message.TS || strings.TrimSpace(message.Text) == "" {
		return false
	}
	if message.Subtype != "" || message.BotID != "" {
		return false
	}
	return botUserID == "" || message.User != botUserID
}

func slackReplyCommentBody(message slackMessageEvent, mappedMember bool) string {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return ""
	}
	if mappedMember {
		return text
	}
	if message.User == "" {
		return "From Slack:\n\n" + text
	}
	return fmt.Sprintf("From Slack <@%s>:\n\n%s", message.User, text)
}

func (h Handler) linkedSlackIssue(ctx context.Context, install slackInstallRecord, channelID, threadTS string) (string, error) {
	var issueID string
	err := h.DB.QueryRow(ctx, `
		select issue_id::text
		from integration_thread_link
		where workspace_integration_id=$1::uuid
			and provider='slack'
			and external_channel_id=$2
			and external_thread_ts=$3
			and issue_id is not null
		order by comment_id is null desc, created_at asc
		limit 1`, install.IntegrationID, channelID, threadTS).Scan(&issueID)
	return issueID, err
}

func (h Handler) insertSlackReplyComment(ctx context.Context, install slackInstallRecord, issueID, actorID, body string, message slackMessageEvent, eventID, permalink string) (bool, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists string
	err = tx.QueryRow(ctx, `
		select id::text
		from integration_thread_link
		where workspace_integration_id=$1::uuid
			and external_channel_id=$2
			and (external_message_ts=$3 or ($4 <> '' and source_event_id=$4))
		limit 1
		for update`, install.IntegrationID, message.Channel, message.TS, eventID).Scan(&exists)
	if err == nil {
		return false, tx.Rollback(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	comment, err := scanSlackSyncedComment(tx.QueryRow(ctx, `
		with inserted as (
			insert into comment (body, issue_id, user_id)
			values ($1, $2::uuid, $3)
			returning id, body, issue_id, user_id, created_at, updated_at
		)
		select inserted.id::text, inserted.body, inserted.issue_id::text, inserted.user_id, u.name, inserted.created_at, inserted.updated_at
		from inserted join "user" u on u.id=inserted.user_id`, body, issueID, actorID))
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `update issue_discussion_summary set status='stale', stale_at=now(), updated_at=now() where issue_id=$1::uuid and status in ('generated','ready')`, issueID); err != nil {
		return false, err
	}
	if err := syncapi.InsertOperation(ctx, tx, install.WorkspaceID, "comment", comment.ID, "created", comment, actorID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, comment_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'slack',$3::uuid,$4::uuid,$5,$6,$7,$8,$9,'inbound',$10)`,
		install.WorkspaceID, install.IntegrationID, issueID, comment.ID, stringValue(install.Metadata["teamId"]), message.Channel, message.ThreadTS, message.TS, permalink, nullString(eventID)); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func scanSlackSyncedComment(row pgx.Row) (slackSyncedComment, error) {
	var comment slackSyncedComment
	var userName string
	var createdAt, updatedAt time.Time
	if err := row.Scan(&comment.ID, &comment.Body, &comment.IssueID, &comment.UserID, &userName, &createdAt, &updatedAt); err != nil {
		return comment, err
	}
	comment.User = map[string]string{"name": userName}
	comment.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	comment.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	comment.Reactions = []any{}
	return comment, nil
}

func insertSlackRootThreadLink(ctx context.Context, tx pgx.Tx, install slackInstallRecord, issueID string, source slackSourceMetadata) error {
	if source.ChannelID == "" || source.MessageTS == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction)
		values ($1::uuid,$2::uuid,'slack',$3::uuid,$4,$5,$6,$7,$8,'inbound')
		on conflict do nothing`, install.WorkspaceID, install.IntegrationID, issueID, firstNonEmpty(source.TeamID, stringValue(install.Metadata["teamId"])), source.ChannelID, firstNonEmpty(source.ThreadTS, source.MessageTS), source.MessageTS, source.Permalink)
	return err
}

func (h Handler) slackUnfurlForURL(ctx context.Context, workspaceID, rawURL string) slackUnfurlAttachment {
	identifier := issueIdentifierFromURL(rawURL)
	if identifier == "" {
		return privateSlackUnfurl(rawURL)
	}
	var title, status, priority string
	var assignee *string
	err := h.DB.QueryRow(ctx, `
		select i.title, ws.name, i.priority::text, u.name
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid and upper(i.identifier)=upper($2)
		limit 1`, workspaceID, identifier).Scan(&title, &status, &priority, &assignee)
	if errors.Is(err, pgx.ErrNoRows) {
		return privateSlackUnfurl(rawURL)
	}
	if err != nil {
		return privateSlackUnfurl(rawURL)
	}
	assigneeName := "Unassigned"
	if assignee != nil && strings.TrimSpace(*assignee) != "" {
		assigneeName = strings.TrimSpace(*assignee)
	}
	return slackUnfurlAttachment{
		Title:     identifier + " " + title,
		TitleLink: rawURL,
		Text:      fmt.Sprintf("*Status:* %s\n*Assignee:* %s\n*Priority:* %s", status, assigneeName, slackPriorityLabel(priority)),
		Color:     slackPriorityColor(priority),
	}
}

func issueIdentifierFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	matches := slackIssueURLPattern.FindStringSubmatch(parsed.EscapedPath())
	if len(matches) < 2 {
		matches = slackIssueURLPattern.FindStringSubmatch(parsed.Path)
	}
	if len(matches) < 2 {
		return ""
	}
	identifier, _ := url.PathUnescape(matches[1])
	return strings.ToUpper(identifier)
}

func isConfiguredAppLink(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return false
	}
	appURL, err := url.Parse(configuredAppURL())
	if err != nil || appURL.Host == "" {
		return false
	}
	return strings.EqualFold(parsed.Host, appURL.Host)
}

func privateSlackUnfurl(rawURL string) slackUnfurlAttachment {
	return slackUnfurlAttachment{
		Title:     "Private exponential link",
		TitleLink: rawURL,
		Text:      "Open in exponential to view this item.",
		Color:     "#6b6f76",
	}
}

func slackPriorityLabel(priority string) string {
	switch priority {
	case "urgent":
		return "Urgent"
	case "high":
		return "High"
	case "medium":
		return "Medium"
	case "low":
		return "Low"
	default:
		return "No priority"
	}
}

func slackPriorityColor(priority string) string {
	switch priority {
	case "urgent":
		return "#ef4444"
	case "high":
		return "#f97316"
	case "medium":
		return "#eab308"
	case "low":
		return "#22c55e"
	default:
		return "#6b6f76"
	}
}

func redactedSlackEventPayload(envelope map[string]any) map[string]any {
	event := recordValue(envelope["event"])
	return map[string]any{
		"eventId": stringValue(envelope["event_id"]),
		"type":    stringValue(envelope["type"]),
		"event": map[string]any{
			"type":    stringValue(event["type"]),
			"subtype": stringValue(event["subtype"]),
			"channel": stringValue(event["channel"]),
		},
	}
}
