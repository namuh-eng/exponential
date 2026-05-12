import TeamHierarchySettingsPage from "@/app/(app)/settings/teams/[key]/hierarchy/page";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "TEAM" }),
}));

describe("TeamHierarchySettingsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the hierarchy settings page", async () => {
    render(<TeamHierarchySettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Parent team").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("No parent team")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
