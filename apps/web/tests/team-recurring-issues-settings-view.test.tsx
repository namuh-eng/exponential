import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamRecurringIssuesSettingsPage from "../src/app/(app)/settings/teams/[key]/recurring-issues/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

const emptyResponse = {
  team: { name: "Engineering", key: "ENG", timezone: "UTC" },
  recurringIssues: [],
};

const existingIssue = {
  id: "recurring-1",
  title: "Weekly triage",
  description: "Review stale issues",
  cadenceConfig: { cadence: "weekly", interval: 1 },
  timezone: "UTC",
  startAt: "2026-07-01T09:00:00.000Z",
  nextRunAt: "2026-07-08T09:00:00.000Z",
  enabled: true,
  priority: "none",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TeamRecurringIssuesSettingsPage component", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(emptyResponse));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders recurring issues settings state", async () => {
    render(<TeamRecurringIssuesSettingsPage />);

    expect(await screen.findByText("Recurring issues")).toBeDefined();
    expect(
      screen.getByText(/Set up scheduled issues that repeat/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New recurring issue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No recurring issues have been configured for this team.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the create form, validates title, saves, and lists the issue", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(emptyResponse))
      .mockResolvedValueOnce(
        jsonResponse(
          { ...existingIssue, title: "Weekly metrics" },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...emptyResponse,
          recurringIssues: [{ ...existingIssue, title: "Weekly metrics" }],
        }),
      );

    render(<TeamRecurringIssuesSettingsPage />);
    await screen.findByRole("button", { name: "New recurring issue" });

    await userEvent.click(
      screen.getByRole("button", { name: "New recurring issue" }),
    );
    expect(
      screen.getByRole("form", { name: "Create recurring issue" }),
    ).toBeDefined();

    await userEvent.click(
      screen.getByRole("button", { name: "Create recurring issue" }),
    );
    expect(screen.getByText("Title is required.")).toBeDefined();

    await userEvent.type(
      screen.getByLabelText("Issue title"),
      "Weekly metrics",
    );
    await userEvent.selectOptions(screen.getByLabelText("Cadence"), "weekly");
    await userEvent.click(
      screen.getByRole("button", { name: "Create recurring issue" }),
    );

    expect(await screen.findByText("Weekly metrics")).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teams/ENG/recurring-issues",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("supports edit, disable, and delete actions", async () => {
    const populatedResponse = {
      ...emptyResponse,
      recurringIssues: [existingIssue],
    };
    const disabledResponse = {
      ...emptyResponse,
      recurringIssues: [{ ...existingIssue, enabled: false }],
    };
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(populatedResponse))
      .mockResolvedValueOnce(
        jsonResponse({ ...existingIssue, title: "Updated triage" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...emptyResponse,
          recurringIssues: [{ ...existingIssue, title: "Updated triage" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...existingIssue, enabled: false }))
      .mockResolvedValueOnce(jsonResponse(disabledResponse))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(emptyResponse));

    render(<TeamRecurringIssuesSettingsPage />);
    expect(await screen.findByText("Weekly triage")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Issue title"));
    await userEvent.type(
      screen.getByLabelText("Issue title"),
      "Updated triage",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Save recurring issue/ }),
    );
    expect(await screen.findByText("Updated triage")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Disabled")).toBeDefined();

    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText(
        "No recurring issues have been configured for this team.",
      ),
    ).toBeDefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/ENG/recurring-issues/recurring-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
