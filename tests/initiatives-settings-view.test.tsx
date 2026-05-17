import "@testing-library/jest-dom/vitest";
import InitiativesSettingsPage from "@/app/(app)/settings/initiatives/page";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("InitiativesSettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Linear-style initiatives settings surface", () => {
    render(<InitiativesSettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Initiatives" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/organize projects into strategic goals/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Feature settings")).toBeInTheDocument();
    expect(screen.getByText("Workspace initiatives")).toBeInTheDocument();
    expect(screen.getByText("Project rollups")).toBeInTheDocument();
    expect(screen.getByText("Workspace visibility")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText(/intentionally read-only/i)).toBeInTheDocument();
  });
});
