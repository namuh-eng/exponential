package integrations

import (
	"bytes"
	"context"
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
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

const (
	slackCreateIssueCallbackID       = "exponential_create_issue"
	slackCreateIssueSubmitCallbackID = "exponential_create_issue_submit"
)

type slackInteractionPayload struct {
	Type       string `json:"type"`
	CallbackID string `json:"callback_id"`
	TriggerID  string `json:"trigger_id"`
	Team       struct {
		ID string `json:"id"`
	} `json:"team"`
	User struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
	} `json:"user"`
	Channel struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"channel"`
	Message slackInteractionMessage `json:"message"`
	View    slackInteractionView    `json:"view"`
}

type slackInteractionMessage struct {
	Text      string `json:"text"`
	TS        string `json:"ts"`
	ThreadTS  string `json:"thread_ts"`
	Permalink string `json:"permalink"`
	User      string `json:"user"`
}

type slackInteractionView struct {
	CallbackID      string `json:"callback_id"`
	PrivateMetadata string `json:"private_metadata"`
	State           struct {
		Values map[string]map[string]slackInteractionStateValue `json:"values"`
	} `json:"state"`
}

type slackInteractionStateValue struct {
	Type            string        `json:"type"`
	Value           string        `json:"value"`
	SelectedOption  *slackOption  `json:"selected_option"`
	SelectedOptions []slackOption `json:"selected_options"`
}

type slackOption struct {
	Text  slackText `json:"text"`
	Value string    `json:"value"`
}

type slackText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type slackInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	Metadata      map[string]any
	BotToken      string
}

type slackIssueTeamOption struct {
	ID            string
	Key           string
	Name          string
	Settings      map[string]any
	TriageEnabled bool
}

type slackIssueFieldOption struct {
	ID       string
	Name     string
	Category string
	Color    string
}

type slackIssueTemplateOption struct {
	ID          string
	Name        string
	Description string
	Settings    map[string]any
}

type slackIssueModalOptions struct {
	Teams      []slackIssueTeamOption
	Statuses   []slackIssueFieldOption
	Assignees  []slackIssueFieldOption
	Labels     []slackIssueFieldOption
	Projects   []slackIssueFieldOption
	Templates  []slackIssueTemplateOption
	Priorities []slackIssueFieldOption
}

type slackIssuePrivateMetadata struct {
	WorkspaceID string              `json:"workspaceId"`
	TeamID      string              `json:"teamId"`
	TeamKey     string              `json:"teamKey"`
	UserID      string              `json:"userId"`
	SlackUserID string              `json:"slackUserId"`
	Source      slackSourceMetadata `json:"source"`
}

type slackSourceMetadata struct {
	TeamID      string `json:"teamId"`
	ChannelID   string `json:"channelId"`
	ChannelName string `json:"channelName"`
	MessageTS   string `json:"messageTs"`
	ThreadTS    string `json:"threadTs"`
	MessageUser string `json:"messageUser"`
	Permalink   string `json:"permalink"`
}

type createdSlackIssue struct {
	ID         string
	Number     int32
	Identifier string
	Title      string
	TeamID     string
	TeamKey    string
	StateID    string
	Priority   string
	AskBacked  bool
}

func (h Handler) SlackInteractivity(w http.ResponseWriter, r *http.Request) {
	payload, ok := readVerifiedSlackInteraction(w, r)
	if !ok {
		return
	}
	if payload.CallbackID != slackCreateIssueCallbackID && payload.View.CallbackID != slackCreateIssueSubmitCallbackID {
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "This Slack action is not supported."})
		return
	}
	install, err := h.resolveSlackInstall(r.Context(), payload.Team.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Slack is not connected to this exponential workspace."})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Slack integration failed", err.Error())
		return
	}
	if !h.workspaceSlackIssueCreationEnabled(r.Context(), install.WorkspaceID) {
		_ = h.recordSlackIssueEvent(r.Context(), install, "issue_creation_disabled", "warning", "Slack issue creation is disabled for this workspace.", map[string]any{"slackTeamId": payload.Team.ID})
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Slack issue creation is disabled for this workspace."})
		return
	}
	switch payload.Type {
	case "message_action", "shortcut":
		h.handleSlackMessageAction(w, r, install, payload)
	case "view_submission":
		h.handleSlackIssueSubmission(w, r, install, payload)
	default:
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Unsupported Slack interaction."})
	}
}

func readVerifiedSlackInteraction(w http.ResponseWriter, r *http.Request) (slackInteractionPayload, bool) {
	signingSecret := strings.TrimSpace(os.Getenv("SLACK_SIGNING_SECRET"))
	if signingSecret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Slack signing secret is not configured", "")
		return slackInteractionPayload{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Slack interaction body could not be read", err.Error())
		return slackInteractionPayload{}, false
	}
	if !verifySlackSignature(signingSecret, r.Header.Get("X-Slack-Request-Timestamp"), r.Header.Get("X-Slack-Signature"), body, time.Now()) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Slack signature", "")
		return slackInteractionPayload{}, false
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Slack interaction form is invalid", err.Error())
		return slackInteractionPayload{}, false
	}
	rawPayload := strings.TrimSpace(values.Get("payload"))
	if rawPayload == "" {
		problem.Write(w, http.StatusBadRequest, "Slack interaction payload is missing", "")
		return slackInteractionPayload{}, false
	}
	var payload slackInteractionPayload
	if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil {
		problem.Write(w, http.StatusBadRequest, "Slack interaction payload is invalid", err.Error())
		return slackInteractionPayload{}, false
	}
	if payload.Team.ID == "" {
		problem.Write(w, http.StatusBadRequest, "Slack interaction is missing team id", "")
		return slackInteractionPayload{}, false
	}
	return payload, true
}

func (h Handler) handleSlackMessageAction(w http.ResponseWriter, r *http.Request, install slackInstallRecord, payload slackInteractionPayload) {
	source := slackSourceFromPayload(payload)
	actorUserID, member := h.slackActorUserID(r.Context(), install, payload.User.ID)
	if !member {
		issue, err := h.createSlackAskIssue(r.Context(), install, payload, source)
		if err != nil {
			_ = h.recordSlackIssueEvent(r.Context(), install, "issue_creation_failed", "error", safeSlackError(err), map[string]any{"source": source})
			problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Unable to create an Ask from this Slack message."})
			return
		}
		_ = h.recordSlackIssueEvent(r.Context(), install, "ask_created_from_slack", "info", "Slack message created an Ask-backed issue.", map[string]any{"issueId": issue.ID, "identifier": issue.Identifier, "source": source})
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Created " + issue.Identifier + " from this Slack message."})
		return
	}
	options, err := h.slackIssueModalOptions(r.Context(), install.WorkspaceID)
	if err != nil {
		_ = h.recordSlackIssueEvent(r.Context(), install, "issue_modal_failed", "error", safeSlackError(err), map[string]any{"slackUserId": payload.User.ID})
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Unable to load exponential issue options."})
		return
	}
	if len(options.Teams) == 0 {
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "No exponential team is available for Slack issue creation."})
		return
	}
	metadata := slackIssuePrivateMetadata{WorkspaceID: install.WorkspaceID, TeamID: options.Teams[0].ID, TeamKey: options.Teams[0].Key, UserID: actorUserID, SlackUserID: payload.User.ID, Source: source}
	view, err := buildSlackIssueModal(payload, metadata, options)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Build Slack modal failed", err.Error())
		return
	}
	if err := openSlackView(r.Context(), http.DefaultClient, install.BotToken, payload.TriggerID, view); err != nil {
		_ = h.recordSlackIssueEvent(r.Context(), install, "issue_modal_failed", "error", safeSlackError(err), map[string]any{"slackUserId": payload.User.ID})
		problem.JSON(w, http.StatusOK, map[string]string{"response_type": "ephemeral", "text": "Unable to open the exponential issue form."})
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) handleSlackIssueSubmission(w http.ResponseWriter, r *http.Request, install slackInstallRecord, payload slackInteractionPayload) {
	metadata := slackIssuePrivateMetadata{}
	if err := json.Unmarshal([]byte(payload.View.PrivateMetadata), &metadata); err != nil {
		problem.JSON(w, http.StatusOK, map[string]any{"response_action": "errors", "errors": map[string]string{"title": "Slack source metadata is invalid."}})
		return
	}
	input := slackIssueInputFromView(payload.View, metadata)
	if strings.TrimSpace(input.Title) == "" {
		problem.JSON(w, http.StatusOK, map[string]any{"response_action": "errors", "errors": map[string]string{"title": "Title is required."}})
		return
	}
	issue, err := h.createSlackIssue(r.Context(), install, input)
	if err != nil {
		_ = h.recordSlackIssueEvent(r.Context(), install, "issue_creation_failed", "error", safeSlackError(err), map[string]any{"slackUserId": metadata.SlackUserID, "source": metadata.Source})
		problem.JSON(w, http.StatusOK, map[string]any{"response_action": "errors", "errors": map[string]string{"title": "Unable to create this exponential issue."}})
		return
	}
	_ = h.recordSlackIssueEvent(r.Context(), install, "issue_created_from_slack", "info", "Slack message created an issue.", map[string]any{"issueId": issue.ID, "identifier": issue.Identifier, "source": metadata.Source})
	_ = h.queueSlackIssueCreatedReply(r.Context(), install, issue, metadata.Source)
	problem.JSON(w, http.StatusOK, map[string]string{"response_action": "clear"})
}

type slackIssueCreateInput struct {
	WorkspaceID string
	TeamID      string
	TeamKey     string
	UserID      string
	SlackUserID string
	SlackName   string
	Title       string
	Description string
	Priority    string
	StateID     string
	AssigneeID  string
	ProjectID   string
	TemplateID  string
	LabelIDs    []string
	UseTriage   bool
	AskBacked   bool
	Source      slackSourceMetadata
}

func slackIssueInputFromView(view slackInteractionView, metadata slackIssuePrivateMetadata) slackIssueCreateInput {
	value := func(block, action string) string {
		actionValue := view.State.Values[block][action]
		if actionValue.SelectedOption != nil {
			return strings.TrimSpace(actionValue.SelectedOption.Value)
		}
		return strings.TrimSpace(actionValue.Value)
	}
	multi := func(block, action string) []string {
		actionValue := view.State.Values[block][action]
		out := []string{}
		for _, option := range actionValue.SelectedOptions {
			if strings.TrimSpace(option.Value) != "" {
				out = append(out, strings.TrimSpace(option.Value))
			}
		}
		return out
	}
	teamID := firstNonEmpty(value("team", "team"), metadata.TeamID)
	return slackIssueCreateInput{
		WorkspaceID: metadata.WorkspaceID,
		TeamID:      teamID,
		TeamKey:     metadata.TeamKey,
		UserID:      metadata.UserID,
		SlackUserID: metadata.SlackUserID,
		Title:       value("title", "title"),
		Description: value("description", "description"),
		Priority:    value("priority", "priority"),
		StateID:     value("status", "status"),
		AssigneeID:  value("assignee", "assignee"),
		ProjectID:   value("project", "project"),
		TemplateID:  value("template", "template"),
		LabelIDs:    multi("labels", "labels"),
		UseTriage:   value("triage", "triage") != "false",
		Source:      metadata.Source,
	}
}

func (h Handler) resolveSlackInstall(ctx context.Context, teamID string) (slackInstallRecord, error) {
	var install slackInstallRecord
	var metadataRaw []byte
	var credentialRaw []byte
	err := h.DB.QueryRow(ctx, `
		select wi.workspace_id::text, wi.id::text, coalesce(wi.connected_by_user_id,''), coalesce(wi.metadata,'{}'::jsonb), coalesce(pc.encrypted_payload,'{}'::bytea)
		from workspace_integration wi
		left join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='slack' and pc.active
		where wi.provider='slack' and wi.external_id=$1 and wi.status in ('connected','degraded')
		limit 1`, teamID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &metadataRaw, &credentialRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &install.Metadata)
	var credential slackCredential
	_ = json.Unmarshal(credentialRaw, &credential)
	install.BotToken = credential.BotToken
	return install, nil
}

func (h Handler) workspaceSlackIssueCreationEnabled(ctx context.Context, workspaceID string) bool {
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return true
	}
	return slackIssueCreationEnabled(readJSONRecord(raw))
}

func (h Handler) teamSlackIssueCreationEnabled(ctx context.Context, teamID string) bool {
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from team where id=$1::uuid`, teamID).Scan(&raw); err != nil {
		return true
	}
	return slackIssueCreationEnabled(readJSONRecord(raw))
}

func slackIssueCreationEnabled(settings map[string]any) bool {
	for _, value := range []any{
		settings["slackIssueCreationEnabled"],
		recordValue(settings["slack"])["issueCreationEnabled"],
		recordValue(settings["slack"])["createIssuesEnabled"],
		recordValue(recordValue(settings["integrations"])["slack"])["issueCreationEnabled"],
		recordValue(recordValue(settings["collaboration"])["asks"])["slackIssueCreationEnabled"],
	} {
		if enabled, ok := value.(bool); ok {
			return enabled
		}
	}
	return true
}

func (h Handler) slackActorUserID(ctx context.Context, install slackInstallRecord, slackUserID string) (string, bool) {
	candidates := []string{}
	for _, key := range []string{"slackUserMap", "userMap"} {
		if mapped := stringValue(recordValue(install.Metadata[key])[slackUserID]); mapped != "" {
			candidates = append(candidates, mapped)
		}
	}
	if stringValue(install.Metadata["authedUser"]) == slackUserID && install.ConnectedBy != "" {
		candidates = append(candidates, install.ConnectedBy)
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

func (h Handler) slackIssueModalOptions(ctx context.Context, workspaceID string) (slackIssueModalOptions, error) {
	teams, err := h.slackIssueTeams(ctx, workspaceID)
	if err != nil || len(teams) == 0 {
		return slackIssueModalOptions{Teams: teams}, err
	}
	firstTeam := teams[0]
	statuses, err := h.slackIssueStatuses(ctx, firstTeam.ID)
	if err != nil {
		return slackIssueModalOptions{}, err
	}
	assignees, err := h.slackIssueAssignees(ctx, firstTeam.ID)
	if err != nil {
		return slackIssueModalOptions{}, err
	}
	labels, err := h.slackIssueLabels(ctx, workspaceID, firstTeam.ID)
	if err != nil {
		return slackIssueModalOptions{}, err
	}
	projects, err := h.slackIssueProjects(ctx, workspaceID)
	if err != nil {
		return slackIssueModalOptions{}, err
	}
	templates, err := h.slackIssueTemplates(ctx, workspaceID, firstTeam.ID)
	if err != nil {
		return slackIssueModalOptions{}, err
	}
	return slackIssueModalOptions{
		Teams:      teams,
		Statuses:   statuses,
		Assignees:  assignees,
		Labels:     labels,
		Projects:   projects,
		Templates:  templates,
		Priorities: prioritySlackOptions(),
	}, nil
}

func (h Handler) slackIssueTeams(ctx context.Context, workspaceID string) ([]slackIssueTeamOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb),coalesce(triage_enabled,true) from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null order by key asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	teams := []slackIssueTeamOption{}
	for rows.Next() {
		var team slackIssueTeamOption
		var raw []byte
		if err := rows.Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled); err != nil {
			return nil, err
		}
		team.Settings = readJSONRecord(raw)
		if slackIssueCreationEnabled(team.Settings) {
			teams = append(teams, team)
		}
	}
	return teams, rows.Err()
}

func (h Handler) slackIssueStatuses(ctx context.Context, teamID string) ([]slackIssueFieldOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,category::text,color from workflow_state where team_id=$1::uuid order by position asc, name asc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlackFieldOptions(rows)
}

func (h Handler) slackIssueAssignees(ctx context.Context, teamID string) ([]slackIssueFieldOption, error) {
	rows, err := h.DB.Query(ctx, `select u.id,u.name,''::text,''::text from team_member tm join "user" u on u.id=tm.user_id where tm.team_id=$1::uuid order by u.name asc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlackFieldOptions(rows)
}

func (h Handler) slackIssueLabels(ctx context.Context, workspaceID, teamID string) ([]slackIssueFieldOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,''::text,color from label where workspace_id=$1::uuid and (team_id is null or team_id=$2::uuid) and archived_at is null order by name asc`, workspaceID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlackFieldOptions(rows)
}

func (h Handler) slackIssueProjects(ctx context.Context, workspaceID string) ([]slackIssueFieldOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,''::text,''::text from project where workspace_id=$1::uuid order by name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlackFieldOptions(rows)
}

func (h Handler) slackIssueTemplates(ctx context.Context, workspaceID, teamID string) ([]slackIssueTemplateOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,description,coalesce(settings,'{}'::jsonb) from issue_template where workspace_id=$1::uuid and (team_id is null or team_id=$2::uuid) order by name asc`, workspaceID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []slackIssueTemplateOption{}
	for rows.Next() {
		var item slackIssueTemplateOption
		var raw []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &raw); err != nil {
			return nil, err
		}
		item.Settings = readJSONRecord(raw)
		if stringValue(item.Settings["archivedAt"]) == "" {
			out = append(out, item)
		}
	}
	return out, rows.Err()
}

type fieldRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func scanSlackFieldOptions(rows fieldRows) ([]slackIssueFieldOption, error) {
	out := []slackIssueFieldOption{}
	for rows.Next() {
		var item slackIssueFieldOption
		if err := rows.Scan(&item.ID, &item.Name, &item.Category, &item.Color); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func prioritySlackOptions() []slackIssueFieldOption {
	return []slackIssueFieldOption{
		{ID: "none", Name: "No priority"},
		{ID: "urgent", Name: "Urgent"},
		{ID: "high", Name: "High"},
		{ID: "medium", Name: "Medium"},
		{ID: "low", Name: "Low"},
	}
}

func buildSlackIssueModal(payload slackInteractionPayload, metadata slackIssuePrivateMetadata, options slackIssueModalOptions) (map[string]any, error) {
	rawMetadata, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	title := defaultSlackIssueTitle(payload.Message.Text)
	description := slackMessageDescription(payload.Message.Text, metadata.Source)
	blocks := []map[string]any{
		staticSelectBlock("team", "team", "Team", teamOptions(options.Teams), options.Teams[0].ID, false),
		plainTextInputBlock("title", "title", "Title", title, false, false),
		plainTextInputBlock("description", "description", "Description", description, true, true),
		staticSelectBlock("status", "status", "Status", fieldOptions(options.Statuses), defaultStatusOption(options.Statuses, options.Teams[0].TriageEnabled), true),
		staticSelectBlock("priority", "priority", "Priority", fieldOptions(options.Priorities), "none", true),
		staticSelectBlock("triage", "triage", "Routing", []slackOption{{Text: slackPlainText("Create in triage when enabled"), Value: "true"}, {Text: slackPlainText("Use selected status"), Value: "false"}}, "true", false),
	}
	if templateOptions := templateOptions(options.Templates); len(templateOptions) > 0 {
		blocks = append(blocks, staticSelectBlock("template", "template", "Template", templateOptions, "", true))
	}
	if assigneeOptions := fieldOptions(options.Assignees); len(assigneeOptions) > 0 {
		blocks = append(blocks, staticSelectBlock("assignee", "assignee", "Assignee", assigneeOptions, "", true))
	}
	if labelOptions := fieldOptions(options.Labels); len(labelOptions) > 0 {
		blocks = append(blocks, multiStaticSelectBlock("labels", "labels", "Labels", labelOptions))
	}
	if projectOptions := fieldOptions(options.Projects); len(projectOptions) > 0 {
		blocks = append(blocks, staticSelectBlock("project", "project", "Project", projectOptions, "", true))
	}
	return map[string]any{
		"type":             "modal",
		"callback_id":      slackCreateIssueSubmitCallbackID,
		"private_metadata": string(rawMetadata),
		"title":            slackPlainText("Create issue"),
		"submit":           slackPlainText("Create"),
		"close":            slackPlainText("Cancel"),
		"blocks":           blocks,
	}, nil
}

func teamOptions(teams []slackIssueTeamOption) []slackOption {
	out := []slackOption{}
	for _, team := range teams {
		out = append(out, slackOption{Text: slackPlainText(team.Key + " - " + team.Name), Value: team.ID})
	}
	return limitSlackOptions(out)
}

func fieldOptions(fields []slackIssueFieldOption) []slackOption {
	out := []slackOption{}
	for _, field := range fields {
		out = append(out, slackOption{Text: slackPlainText(field.Name), Value: field.ID})
	}
	return limitSlackOptions(out)
}

func templateOptions(templates []slackIssueTemplateOption) []slackOption {
	out := []slackOption{}
	for _, template := range templates {
		out = append(out, slackOption{Text: slackPlainText(template.Name), Value: template.ID})
	}
	return limitSlackOptions(out)
}

func limitSlackOptions(options []slackOption) []slackOption {
	if len(options) > 100 {
		return options[:100]
	}
	return options
}

func defaultStatusOption(statuses []slackIssueFieldOption, triageEnabled bool) string {
	wanted := "backlog"
	if triageEnabled {
		wanted = "triage"
	}
	for _, status := range statuses {
		if status.Category == wanted {
			return status.ID
		}
	}
	if len(statuses) == 0 {
		return ""
	}
	return statuses[0].ID
}

func staticSelectBlock(blockID, actionID, label string, options []slackOption, initialValue string, optional bool) map[string]any {
	element := map[string]any{"type": "static_select", "action_id": actionID, "options": options}
	if initialValue != "" {
		for _, option := range options {
			if option.Value == initialValue {
				element["initial_option"] = option
				break
			}
		}
	}
	return map[string]any{"type": "input", "block_id": blockID, "optional": optional, "label": slackPlainText(label), "element": element}
}

func multiStaticSelectBlock(blockID, actionID, label string, options []slackOption) map[string]any {
	return map[string]any{"type": "input", "block_id": blockID, "optional": true, "label": slackPlainText(label), "element": map[string]any{"type": "multi_static_select", "action_id": actionID, "options": options}}
}

func plainTextInputBlock(blockID, actionID, label, initialValue string, multiline bool, optional bool) map[string]any {
	element := map[string]any{"type": "plain_text_input", "action_id": actionID, "initial_value": truncateSlackText(initialValue, 3000)}
	if multiline {
		element["multiline"] = true
	}
	return map[string]any{"type": "input", "block_id": blockID, "optional": optional, "label": slackPlainText(label), "element": element}
}

func slackPlainText(value string) slackText {
	return slackText{Type: "plain_text", Text: truncateSlackText(value, 75)}
}

func truncateSlackText(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= max {
		return string(runes)
	}
	if max <= 1 {
		return string(runes[:max])
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
}

func (h Handler) createSlackAskIssue(ctx context.Context, install slackInstallRecord, payload slackInteractionPayload, source slackSourceMetadata) (createdSlackIssue, error) {
	team, err := h.defaultSlackAskTeam(ctx, install.WorkspaceID, source.ChannelID)
	if err != nil {
		return createdSlackIssue{}, err
	}
	creatorID, err := h.workspaceIssueCreator(ctx, install.WorkspaceID)
	if err != nil {
		return createdSlackIssue{}, err
	}
	priority := h.workspaceAskPriority(ctx, install.WorkspaceID)
	return h.createSlackIssue(ctx, install, slackIssueCreateInput{
		WorkspaceID: install.WorkspaceID,
		TeamID:      team.ID,
		TeamKey:     team.Key,
		UserID:      creatorID,
		SlackUserID: payload.User.ID,
		SlackName:   firstNonEmpty(payload.User.Name, payload.User.Username, payload.User.ID),
		Title:       defaultSlackIssueTitle(payload.Message.Text),
		Description: slackMessageDescription(payload.Message.Text, source),
		Priority:    priority,
		UseTriage:   true,
		AskBacked:   true,
		Source:      source,
	})
}

func (h Handler) defaultSlackAskTeam(ctx context.Context, workspaceID, channelID string) (slackIssueTeamOption, error) {
	var team slackIssueTeamOption
	var raw []byte
	err := h.DB.QueryRow(ctx, `
		select t.id::text,t.key,t.name,coalesce(t.settings,'{}'::jsonb),coalesce(t.triage_enabled,true)
		from team t
		join team_notification_integration tni on tni.team_id=t.id
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null and tni.provider='slack' and tni.channel_id=$2
		order by t.key asc
		limit 1`, workspaceID, channelID).Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		err = h.DB.QueryRow(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb),coalesce(triage_enabled,true) from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null order by key asc limit 1`, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled)
	}
	if err != nil {
		return team, err
	}
	team.Settings = readJSONRecord(raw)
	if !slackIssueCreationEnabled(team.Settings) {
		return team, fmt.Errorf("Slack issue creation is disabled for team %s", team.Key)
	}
	return team, nil
}

func (h Handler) workspaceIssueCreator(ctx context.Context, workspaceID string) (string, error) {
	var id string
	err := h.DB.QueryRow(ctx, `select user_id from member where workspace_id=$1::uuid order by created_at asc limit 1`, workspaceID).Scan(&id)
	return id, err
}

func (h Handler) workspaceAskPriority(ctx context.Context, workspaceID string) string {
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return "medium"
	}
	settings := readJSONRecord(raw)
	priority := stringValue(recordValue(recordValue(settings["collaboration"])["asks"])["defaultPriority"])
	if !validSlackPriority(priority) {
		return "medium"
	}
	return priority
}

func (h Handler) createSlackIssue(ctx context.Context, install slackInstallRecord, input slackIssueCreateInput) (createdSlackIssue, error) {
	if input.WorkspaceID == "" {
		input.WorkspaceID = install.WorkspaceID
	}
	if input.Priority == "" {
		input.Priority = "none"
	}
	if !validSlackPriority(input.Priority) {
		input.Priority = "none"
	}
	if input.TemplateID != "" {
		_ = h.applySlackIssueTemplate(ctx, &input)
	}
	if strings.TrimSpace(input.Title) == "" {
		return createdSlackIssue{}, fmt.Errorf("title is required")
	}
	if !h.teamSlackIssueCreationEnabled(ctx, input.TeamID) {
		return createdSlackIssue{}, fmt.Errorf("Slack issue creation is disabled for this team")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return createdSlackIssue{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := slackIssueTeamForCreate(ctx, tx, input.WorkspaceID, input.TeamID)
	if err != nil {
		return createdSlackIssue{}, err
	}
	stateID := input.StateID
	if input.UseTriage && team.TriageEnabled {
		stateID, err = slackIssueStateByCategory(ctx, tx, input.TeamID, "triage")
	} else if stateID == "" {
		stateID, err = slackIssueStateByCategory(ctx, tx, input.TeamID, "backlog")
	} else {
		err = assertSlackStateForTeam(ctx, tx, input.TeamID, stateID)
	}
	if err != nil {
		return createdSlackIssue{}, err
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, input.TeamID).Scan(&nextNumber); err != nil {
		return createdSlackIssue{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := slackIssueDescriptionHTML(input.Description, input.Source)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,assignee_id,creator_id,priority,project_id)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8,$9,$10::uuid)
		returning id::text`, nextNumber, identifier, strings.TrimSpace(input.Title), description, input.TeamID, stateID, nullString(input.AssigneeID), input.UserID, input.Priority, nullString(input.ProjectID)).Scan(&issueID); err != nil {
		return createdSlackIssue{}, err
	}
	for _, labelID := range input.LabelIDs {
		if strings.TrimSpace(labelID) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `insert into issue_label (issue_id,label_id) select $1::uuid,l.id from label l where l.id=$2::uuid and l.workspace_id=$3::uuid and (l.team_id is null or l.team_id=$4::uuid) on conflict do nothing`, issueID, labelID, input.WorkspaceID, input.TeamID); err != nil {
			return createdSlackIssue{}, err
		}
	}
	history := slackIssueHistoryMetadata(identifier, strings.TrimSpace(input.Title), input, issueBacklink(team.Key, identifier))
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,$3,null,'created',$4::jsonb)`, issueID, nullString(input.UserID), nullString(input.SlackName), historyRaw); err != nil {
		return createdSlackIssue{}, err
	}
	if err := insertSlackRootThreadLink(ctx, tx, install, issueID, input.Source); err != nil {
		return createdSlackIssue{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return createdSlackIssue{}, err
	}
	return createdSlackIssue{ID: issueID, Number: nextNumber, Identifier: identifier, Title: input.Title, TeamID: input.TeamID, TeamKey: team.Key, StateID: stateID, Priority: input.Priority, AskBacked: input.AskBacked}, nil
}

func (h Handler) applySlackIssueTemplate(ctx context.Context, input *slackIssueCreateInput) error {
	var raw []byte
	var description string
	err := h.DB.QueryRow(ctx, `select description, coalesce(settings,'{}'::jsonb) from issue_template where id=$1::uuid and workspace_id=$2::uuid and (team_id is null or team_id=$3::uuid) limit 1`, input.TemplateID, input.WorkspaceID, input.TeamID).Scan(&description, &raw)
	if err != nil {
		return err
	}
	settings := readJSONRecord(raw)
	if strings.TrimSpace(input.Title) == "" {
		input.Title = firstNonEmpty(stringValue(settings["title"]), stringValue(settings["name"]))
	}
	if strings.TrimSpace(input.Description) == "" {
		input.Description = firstNonEmpty(stringValue(settings["body"]), description)
	}
	if input.Priority == "" || input.Priority == "none" {
		if priority := stringValue(settings["defaultPriority"]); validSlackPriority(priority) {
			input.Priority = priority
		}
	}
	if input.StateID == "" {
		input.StateID = stringValue(settings["defaultStatusId"])
	}
	if input.ProjectID == "" {
		input.ProjectID = stringValue(settings["defaultProjectId"])
	}
	return nil
}

type slackCreateQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func slackIssueTeamForCreate(ctx context.Context, q slackCreateQuerier, workspaceID, teamID string) (slackIssueTeamOption, error) {
	var team slackIssueTeamOption
	err := q.QueryRow(ctx, `select id::text,key,name,coalesce(triage_enabled,true) from team where id=$1::uuid and workspace_id=$2::uuid and deleted_at is null and retired_at is null`, teamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &team.TriageEnabled)
	return team, err
}

func slackIssueStateByCategory(ctx context.Context, q slackCreateQuerier, teamID, category string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `select id::text from workflow_state where team_id=$1::uuid and category=$2::workflow_state_category order by coalesce(is_default,false) desc, position asc, name asc, id asc limit 1`, teamID, category).Scan(&id)
	return id, err
}

func assertSlackStateForTeam(ctx context.Context, q slackCreateQuerier, teamID, stateID string) error {
	var id string
	return q.QueryRow(ctx, `select id::text from workflow_state where id=$1::uuid and team_id=$2::uuid`, stateID, teamID).Scan(&id)
}

func slackIssueHistoryMetadata(identifier, title string, input slackIssueCreateInput, issueURL string) map[string]any {
	sourceType := "slack_message"
	if input.AskBacked {
		sourceType = "slack_ask"
	}
	return map[string]any{
		"identifier": identifier,
		"title":      title,
		"teamId":     input.TeamID,
		"source":     sourceType,
		"backlink":   issueURL,
		"slack": map[string]any{
			"teamId":      input.Source.TeamID,
			"channelId":   input.Source.ChannelID,
			"channelName": input.Source.ChannelName,
			"messageTs":   input.Source.MessageTS,
			"threadTs":    input.Source.ThreadTS,
			"messageUser": input.Source.MessageUser,
			"permalink":   input.Source.Permalink,
			"actorUserId": input.SlackUserID,
		},
	}
}

func (h Handler) queueSlackIssueCreatedReply(ctx context.Context, install slackInstallRecord, issue createdSlackIssue, source slackSourceMetadata) error {
	if source.ChannelID == "" {
		return nil
	}
	payload := map[string]any{
		"channel":   source.ChannelID,
		"text":      fmt.Sprintf("Created <%s|%s> from this Slack message.", issueBacklink(issue.TeamKey, issue.Identifier), issue.Identifier),
		"thread_ts": firstNonEmpty(source.ThreadTS, source.MessageTS),
	}
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		values ($1::uuid,$2::uuid,'slack','outbound_delivery','queued',$3::jsonb,now(),now())`, install.WorkspaceID, install.IntegrationID, raw)
	return err
}

func (h Handler) recordSlackIssueEvent(ctx context.Context, install slackInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload)
		values ($1::uuid,$2::uuid,'slack',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func slackSourceFromPayload(payload slackInteractionPayload) slackSourceMetadata {
	threadTS := payload.Message.ThreadTS
	if threadTS == "" {
		threadTS = payload.Message.TS
	}
	return slackSourceMetadata{
		TeamID:      payload.Team.ID,
		ChannelID:   payload.Channel.ID,
		ChannelName: payload.Channel.Name,
		MessageTS:   payload.Message.TS,
		ThreadTS:    threadTS,
		MessageUser: payload.Message.User,
		Permalink:   firstNonEmpty(payload.Message.Permalink, slackAppRedirect(payload.Team.ID, payload.Channel.ID, payload.Message.TS)),
	}
}

func slackAppRedirect(teamID, channelID, messageTS string) string {
	if channelID == "" || messageTS == "" {
		return ""
	}
	values := url.Values{}
	values.Set("channel", channelID)
	values.Set("message_ts", messageTS)
	if teamID != "" {
		values.Set("team", teamID)
	}
	return "https://slack.com/app_redirect?" + values.Encode()
}

func defaultSlackIssueTitle(message string) string {
	plain := strings.TrimSpace(strings.ReplaceAll(message, "\u00a0", " "))
	for _, line := range strings.Split(plain, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return truncateSlackText(line, 120)
		}
	}
	return "Slack request"
}

func slackMessageDescription(message string, source slackSourceMetadata) string {
	parts := []string{}
	if strings.TrimSpace(message) != "" {
		parts = append(parts, strings.TrimSpace(message))
	}
	if source.Permalink != "" {
		parts = append(parts, "Source: "+source.Permalink)
	}
	return strings.Join(parts, "\n\n")
}

func slackIssueDescriptionHTML(description string, source slackSourceMetadata) string {
	description = strings.TrimSpace(description)
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + strings.ReplaceAll(html.EscapeString(description), "\n", "<br>") + "</p>"
	}
	if source.Permalink == "" {
		return description
	}
	link := `<p><a href="` + html.EscapeString(source.Permalink) + `">View source message in Slack</a></p>`
	return sanitizehtml.RichText(description + link)
}

func issueBacklink(teamKey, identifier string) string {
	return strings.TrimRight(configuredAppURL(), "/") + "/team/" + url.PathEscape(teamKey) + "/issue/" + url.PathEscape(identifier)
}

func readJSONRecord(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func nullString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func validSlackPriority(value string) bool {
	switch value {
	case "none", "urgent", "high", "medium", "low":
		return true
	default:
		return false
	}
}

func safeSlackError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if strings.Contains(strings.ToLower(msg), "token") {
		return "Slack issue creation failed."
	}
	return msg
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func openSlackView(ctx context.Context, client *http.Client, botToken, triggerID string, view map[string]any) error {
	if strings.TrimSpace(botToken) == "" {
		return fmt.Errorf("active Slack credential is missing bot token")
	}
	body, err := json.Marshal(map[string]any{"trigger_id": triggerID, "view": view})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackAPIBaseURL()+"/views.open", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var decoded struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Slack views.open returned HTTP %d", resp.StatusCode)
	}
	if !decoded.OK {
		if decoded.Error == "" {
			decoded.Error = "unknown_error"
		}
		return fmt.Errorf("Slack views.open failed: %s", decoded.Error)
	}
	return nil
}
