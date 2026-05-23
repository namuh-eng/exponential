/* Auto-generated from packages/proto/openapi.yaml. Regenerate with pnpm --filter @exponential/sdk generate. */
export interface paths {
  "/issues": {
    get: {
      parameters: {
        query?: { cursor?: string; limit?: number; team_id?: string };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["IssueListResponse"];
          };
        };
      };
    };
    post: {
      parameters: { header?: { "Idempotency-Key"?: string } };
      requestBody: {
        content: {
          "application/json": components["schemas"]["CreateIssueRequest"];
        };
      };
      responses: {
        201: {
          content: { "application/json": components["schemas"]["Issue"] };
        };
      };
    };
  };
  "/issues/{id}": {
    get: {
      parameters: { path: { id: string } };
      responses: {
        200: {
          content: { "application/json": components["schemas"]["Issue"] };
        };
      };
    };
    patch: {
      parameters: {
        path: { id: string };
        header?: { "Idempotency-Key"?: string };
      };
      requestBody: {
        content: {
          "application/json": components["schemas"]["UpdateIssueRequest"];
        };
      };
      responses: {
        200: {
          content: { "application/json": components["schemas"]["Issue"] };
        };
      };
    };
    delete: {
      parameters: {
        path: { id: string };
        header?: { "Idempotency-Key"?: string };
      };
      responses: {
        200: { content: { "application/json": { success: boolean } } };
      };
    };
  };
}
export interface components {
  schemas: {
    IssuePriority: "none" | "urgent" | "high" | "medium" | "low";
    Issue: {
      id: string;
      number: number;
      identifier: string;
      title: string;
      description?: string | null;
      team_id: string;
      state_id: string;
      assignee_id?: string | null;
      creator_id: string;
      priority: components["schemas"]["IssuePriority"];
      estimate?: number | null;
      parent_issue_id?: string | null;
      project_id?: string | null;
      project_milestone_id?: string | null;
      cycle_id?: string | null;
      due_date?: string | null;
      sort_order?: number;
      created_at: string;
      updated_at: string;
      archived_at?: string | null;
      canceled_at?: string | null;
      completed_at?: string | null;
    };
    IssueListResponse: {
      data: components["schemas"]["Issue"][];
      next_cursor?: string | null;
    };
    CreateIssueRequest: {
      title: string;
      description?: string | null;
      team_id: string;
      state_id?: string | null;
      priority?: components["schemas"]["IssuePriority"];
      assignee_id?: string | null;
      project_id?: string | null;
      project_milestone_id?: string | null;
      cycle_id?: string | null;
      parent_issue_id?: string | null;
      estimate?: number | null;
      due_date?: string | null;
    };
    UpdateIssueRequest: Partial<
      Omit<components["schemas"]["CreateIssueRequest"], "team_id"> & {
        state_id: string;
        sort_order: number;
        archive: boolean;
      }
    >;
  };
}
