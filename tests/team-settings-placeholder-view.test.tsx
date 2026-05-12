import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamSettingsPlaceholderPage from "@/app/(app)/settings/teams/[key]/[section]/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("TeamSettingsPlaceholderPage component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the members section correctly", () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG", section: "members" });

    render(<TeamSettingsPlaceholderPage />);

    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(
      screen.getByText(/Review and manage team membership/),
    ).toBeInTheDocument();
    expect(screen.getByText("Back to team settings")).toHaveAttribute(
      "href",
      "/settings/teams/ENG",
    );
  });

  it("renders the cycles section correctly", () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG", section: "cycles" });

    render(<TeamSettingsPlaceholderPage />);

    expect(screen.getByText("Cycles")).toBeInTheDocument();
    expect(
      screen.getByText(/Adjust the team's cycle cadence/),
    ).toBeInTheDocument();
  });

  it("renders a fallback for unknown sections", () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG", section: "unknown" });

    render(<TeamSettingsPlaceholderPage />);

    expect(screen.getByText("Team settings")).toBeInTheDocument();
    expect(
      screen.getByText("This team settings section is not available."),
    ).toBeInTheDocument();
  });

  it("renders the slack-notifications section correctly", () => {
    vi.mocked(useParams).mockReturnValue({
      key: "PROD",
      section: "slack-notifications",
    });

    render(<TeamSettingsPlaceholderPage />);

    expect(screen.getByText("Slack notifications")).toBeInTheDocument();
    expect(screen.getByText(/Connect a Slack channel/)).toBeInTheDocument();
  });
});
