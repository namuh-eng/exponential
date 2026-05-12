import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamRecurringIssuesSettingsPage from "../src/app/(app)/settings/teams/[key]/recurring-issues/page";

// Mock useParams
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "ENG" }),
}));

describe("TeamRecurringIssuesSettingsPage component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders recurring issues settings state", () => {
    render(<TeamRecurringIssuesSettingsPage />);

    expect(screen.getByText("Recurring issues")).toBeDefined();
    expect(
      screen.getByText(/Set up scheduled issues that repeat/i),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "New recurring issue" }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "No recurring issues have been configured for this team.",
      ),
    ).toBeDefined();
  });
});
