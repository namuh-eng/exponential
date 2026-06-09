package analytics

import "testing"

func TestWorkspaceResponseShape(t *testing.T) {
	payload := workspaceResponse{WorkspaceID: "ws", CompletedLast30Days: []completedTeamCount{}, ActiveIssues: []activeTeamCount{}, Period: "Last 30 days"}
	if payload.Period != "Last 30 days" || payload.WorkspaceID != "ws" {
		t.Fatalf("payload = %#v", payload)
	}
}
