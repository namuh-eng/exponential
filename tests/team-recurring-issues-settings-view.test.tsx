import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamRecurringIssuesSettingsPage from "../src/app/(app)/settings/teams/[key]/recurring-issues/page";

const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamRecurringIssuesSettingsPage component", () => {
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

  it("renders recurring issues settings state", async () => {
    render(<TeamRecurringIssuesSettingsPage />);

    expect(await screen.findByText("Recurring issues")).toBeInTheDocument();
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
});
