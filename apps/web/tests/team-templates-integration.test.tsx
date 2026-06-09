import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TeamTemplatesSettingsPage from "@/app/(app)/settings/teams/[key]/templates/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useLink: vi.fn(),
}));

describe("TeamTemplatesSettingsPage integration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockTemplatesData = {
    team: { name: "Engineering" },
    templates: [
      {
        id: "temp-1",
        name: "Backend Project",
        description: "Standard API project setup",
      },
      {
        id: "temp-2",
        name: "Frontend Sprint",
        description: "React component library template",
      },
    ],
  };

  it("renders the templates list from the team API", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTemplatesData),
      }),
    );

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() =>
      expect(screen.getByText("Templates")).toBeInTheDocument(),
    );

    expect(screen.getByText("Backend Project")).toBeInTheDocument();
    expect(screen.getByText("Standard API project setup")).toBeInTheDocument();
    expect(screen.getByText("Frontend Sprint")).toBeInTheDocument();
    expect(screen.getByText(/Create reusable templates/)).toBeInTheDocument();
  });

  it("shows an empty state when the team has no templates", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "EMPTY" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ team: { name: "Empty Team" }, templates: [] }),
      }),
    );

    render(<TeamTemplatesSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No templates have been created for this team."),
      ).toBeInTheDocument();
    });
  });
});
