package issues

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type relationRequest struct {
	TargetIssueID  *string `json:"targetIssueId"`
	RelatedIssueID *string `json:"relatedIssueId"`
	Type           string  `json:"type"`
}

type relationIssue struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
}

type relationRecord struct {
	ID             string `json:"id"`
	IssueID        string `json:"issueId"`
	RelatedIssueID string `json:"relatedIssueId"`
	Type           string `json:"type"`
}

type relationResponse struct {
	ID    string        `json:"id"`
	Type  string        `json:"type"`
	Issue relationIssue `json:"issue"`
}

func (h Handler) CreateRelation(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input relationRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	targetIssueID := valueOrEmpty(input.TargetIssueID)
	if targetIssueID == "" {
		targetIssueID = valueOrEmpty(input.RelatedIssueID)
	}
	if !isRelationType(input.Type) || targetIssueID == "" {
		problem.Write(w, 400, "A supported relation type and targetIssueId are required", "")
		return
	}
	source, err := h.findRelationIssue(r, chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	target, err := h.findRelationIssue(r, targetIssueID, p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Target issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	if source.ID == target.ID {
		problem.Write(w, 400, "An issue cannot relate to itself", "")
		return
	}
	issueID, relatedID, storedType := normalizeStoredRelation(source.ID, target.ID, input.Type)
	exists, err := h.relationExists(r, issueID, relatedID, storedType, input.Type)
	if err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	if exists {
		problem.Write(w, 409, "Issue relation already exists", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var created relationRecord
	if err := tx.QueryRow(r.Context(), `insert into issue_relation (issue_id, related_issue_id, type) values ($1::uuid,$2::uuid,$3) returning id::text, issue_id::text, related_issue_id::text, type::text`, issueID, relatedID, storedType).Scan(&created.ID, &created.IssueID, &created.RelatedIssueID, &created.Type); err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	metadata := map[string]any{"changedFields": []string{"relations"}, "action": "relation_created", "relationId": created.ID, "relationType": input.Type, "targetIssueId": target.ID, "targetIdentifier": target.Identifier}
	if err := insertIssueHistory(r, tx, source.ID, p.UserID, "updated", metadata); err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create issue relation failed", err.Error())
		return
	}
	problem.JSON(w, 201, relationResponse{ID: created.ID, Type: displayStoredRelation(source.ID, created), Issue: target})
}

func (h Handler) DeleteRelation(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	source, err := h.findRelationIssue(r, chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	relationID := chi.URLParam(r, "relationID")
	var relation relationRecord
	if err := h.DB.QueryRow(r.Context(), `select id::text, issue_id::text, related_issue_id::text, type::text from issue_relation where id=$1::uuid and (issue_id=$2::uuid or related_issue_id=$2::uuid) limit 1`, relationID, source.ID).Scan(&relation.ID, &relation.IssueID, &relation.RelatedIssueID, &relation.Type); errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue relation not found", "")
		return
	} else if err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	otherID := relation.RelatedIssueID
	if relation.IssueID != source.ID {
		otherID = relation.IssueID
	}
	other, err := h.findRelationIssue(r, otherID, p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue relation not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `delete from issue_relation where id=$1::uuid`, relation.ID); err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	metadata := map[string]any{"changedFields": []string{"relations"}, "action": "relation_deleted", "relationId": relation.ID, "relationType": relation.Type, "targetIssueId": otherID, "targetIdentifier": other.Identifier}
	if err := insertIssueHistory(r, tx, source.ID, p.UserID, "updated", metadata); err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete issue relation failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) findRelationIssue(r *http.Request, id, workspaceID string) (relationIssue, error) {
	where := "i.identifier=$2"
	if stringsCountHyphen(id) == 4 && len(id) >= 32 {
		where = "i.id=$2::uuid"
	}
	var issue relationIssue
	err := h.DB.QueryRow(r.Context(), `select i.id::text,i.identifier,i.title from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and `+where+` limit 1`, workspaceID, id).Scan(&issue.ID, &issue.Identifier, &issue.Title)
	return issue, err
}

func isRelationType(value string) bool {
	switch value {
	case "blocks", "blocked_by", "duplicate", "related":
		return true
	default:
		return false
	}
}

func normalizeStoredRelation(sourceID, targetID, relationType string) (string, string, string) {
	if relationType == "blocked_by" {
		return targetID, sourceID, "blocks"
	}
	if relationType == "duplicate" || relationType == "related" {
		if targetID < sourceID {
			return targetID, sourceID, relationType
		}
		return sourceID, targetID, relationType
	}
	return sourceID, targetID, "blocks"
}

func displayStoredRelation(currentIssueID string, relation relationRecord) string {
	if relation.Type == "duplicate" || relation.Type == "related" {
		return relation.Type
	}
	if currentIssueID == relation.IssueID {
		return "blocks"
	}
	return "blocked_by"
}

func (h Handler) relationExists(r *http.Request, issueID, relatedID, storedType, requestedType string) (bool, error) {
	typeClause := "type=$3"
	args := []any{issueID, relatedID, storedType}
	if requestedType == "blocks" || requestedType == "blocked_by" {
		typeClause = "type in ('blocks','blocked_by')"
		args = []any{issueID, relatedID}
	}
	var exists bool
	err := h.DB.QueryRow(r.Context(), `select exists(select 1 from issue_relation where `+typeClause+` and ((issue_id=$1::uuid and related_issue_id=$2::uuid) or (issue_id=$2::uuid and related_issue_id=$1::uuid)))`, args...).Scan(&exists)
	return exists, err
}

func insertIssueHistory(r *http.Request, tx pgx.Tx, issueID, actorID, eventType string, metadata map[string]any) error {
	raw, _ := json.Marshal(metadata)
	_, err := tx.Exec(r.Context(), `insert into issue_history (issue_id, actor_id, event_type, metadata) values ($1::uuid,$2,$3,$4::jsonb)`, issueID, actorID, eventType, raw)
	return err
}

func stringsCountHyphen(value string) int {
	count := 0
	for _, char := range value {
		if char == '-' {
			count++
		}
	}
	return count
}
