import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamRecurringIssuesSettingsPage from "@/app/(app)/settings/teams/[key]/recurring-issues/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG", workspaceSlug: "foreverbrowsing" }),
}));

const savedIssue = {
  id: "recurring-1",
  title: "Weekly metrics review",
  description: "Review dashboards",
  cadenceConfig: {
    cadence: "weekly",
    interval: 1,
    startDate: "2026-05-21",
    time: "09:00",
  },
  cadenceLabel: "Weekly",
  timezone: "UTC",
  nextRunAt: "2026-05-21T09:00:00.000Z",
  enabled: true,
};

describe("TeamRecurringIssuesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        team: { name: "Engineering", key: "ENG" },
        recurringIssues: [],
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens the create dialog from the CTA", async () => {
    render(<TeamRecurringIssuesSettingsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "New recurring issue" }),
    );

    expect(
      screen.getByRole("form", { name: "Create recurring issue" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Issue title")).toBeInTheDocument();
    expect(screen.getByLabelText("Cadence")).toBeInTheDocument();
  });

  it("validates, creates, lists, disables, edits, and deletes a recurring issue", async () => {
    // Track state so fetchRecurringIssues() reloads always return current list.
    const issueList: (typeof savedIssue)[] = [];
    let nextPatchResponse: typeof savedIssue | null = null;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const base = "/api/teams/ENG/recurring-issues";
      // List / reload
      if (url === base && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            team: { name: "Engineering", key: "ENG" },
            recurringIssues: [...issueList],
          }),
        });
      }
      // Create
      if (url === base && init?.method === "POST") {
        issueList.push(savedIssue);
        return Promise.resolve({
          ok: true,
          json: async () => ({ recurringIssue: savedIssue }),
        });
      }
      // PATCH (toggle or edit)
      if (url.startsWith(`${base}/`) && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        if (nextPatchResponse) {
          const resp = nextPatchResponse;
          nextPatchResponse = null;
          const idx = issueList.findIndex((i) => i.id === savedIssue.id);
          if (idx >= 0) issueList[idx] = { ...issueList[idx], ...resp };
          return Promise.resolve({
            ok: true,
            json: async () => ({ recurringIssue: resp }),
          });
        }
        // Toggle enabled sends the full recurring issue payload for API parity.
        if (
          "enabled" in body &&
          body.enabled === false &&
          body.title === savedIssue.title
        ) {
          const toggled = { ...savedIssue, enabled: Boolean(body.enabled) };
          const idx = issueList.findIndex((i) => i.id === savedIssue.id);
          if (idx >= 0) issueList[idx] = toggled;
          return Promise.resolve({
            ok: true,
            json: async () => ({ recurringIssue: toggled }),
          });
        }
        // Edit
        const edited = {
          ...savedIssue,
          title: "Monthly metrics review",
          cadenceLabel: "Monthly",
          cadenceConfig: {
            cadence: "monthly",
            interval: 1,
            startDate: "2026-05-21",
            time: "09:00",
          },
        };
        const idx = issueList.findIndex((i) => i.id === savedIssue.id);
        if (idx >= 0) issueList[idx] = edited;
        return Promise.resolve({
          ok: true,
          json: async () => ({ recurringIssue: edited }),
        });
      }
      // DELETE
      if (url.startsWith(`${base}/`) && init?.method === "DELETE") {
        issueList.length = 0;
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<TeamRecurringIssuesSettingsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "New recurring issue" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("form", { name: "Create recurring issue" }),
      ).getByRole("button", { name: "Create recurring issue" }),
    );
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Issue title"), {
      target: { value: "Weekly metrics review" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Review dashboards" },
    });
    fireEvent.change(screen.getByLabelText("Cadence"), {
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-05-21" },
    });
    fireEvent.click(
      within(
        screen.getByRole("form", { name: "Create recurring issue" }),
      ).getByRole("button", { name: "Create recurring issue" }),
    );

    expect(
      await screen.findByText("Weekly metrics review"),
    ).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Issue title"), {
      target: { value: "Monthly metrics review" },
    });
    fireEvent.change(screen.getByLabelText("Cadence"), {
      target: { value: "monthly" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Save recurring issue/ }),
    );

    expect(
      await screen.findByText("Monthly metrics review"),
    ).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Monthly metrics review"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "No recurring issues have been configured for this team.",
      ),
    ).toBeInTheDocument();
  });
});
