import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AgentPersonalizationPage from "@/app/(app)/settings/account/agents/page";
import TeamAgentsSettingsPage from "@/app/(app)/settings/teams/[key]/agents/page";
import { useParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

describe("Agent Personalization & Team Guidance", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates account-level agent instructions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accountPreferences: {
              agentPersonalization: { instructions: "Initial", autoFix: false },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<AgentPersonalizationPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue("Initial")).toBeInTheDocument(),
    );

    const textarea = screen.getByDisplayValue("Initial");
    fireEvent.change(textarea, { target: { value: "New rules" } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"instructions":"New rules"'),
        }),
      );
    });

    expect(screen.getByText("Preferences saved")).toBeInTheDocument();
  });

  it("updates team-level agent guidance", async () => {
    vi.mocked(useParams).mockReturnValue({ key: "ENG" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            team: {
              name: "Engineering",
              agentGuidance: "Team rules",
              autoAssignment: true,
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<TeamAgentsSettingsPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue("Team rules")).toBeInTheDocument(),
    );

    const textarea = screen.getByDisplayValue("Team rules");
    fireEvent.change(textarea, { target: { value: "Standardize hooks" } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teams/ENG/settings",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"agentGuidance":"Standardize hooks"'),
        }),
      );
    });

    expect(screen.getByText("Agent settings updated")).toBeInTheDocument();
  });
});
