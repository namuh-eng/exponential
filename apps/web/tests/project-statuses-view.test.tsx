import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectStatusesPage from "@/app/(app)/settings/project-statuses/page";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const statusPayload = {
  statuses: [
    {
      id: "planned",
      key: "planned",
      name: "Planned",
      description:
        "Projects that are proposed or scheduled but not active yet.",
      color: "#6b6f76",
      icon: "○",
      position: 0,
      isDefault: true,
      projectCount: 2,
    },
    {
      id: "started",
      key: "started",
      name: "In progress",
      description: "Projects that are actively being worked on.",
      color: "#b58900",
      icon: "◐",
      position: 1,
      isDefault: true,
      projectCount: 1,
    },
    {
      id: "paused",
      key: "paused",
      name: "Paused",
      description: "Projects that are temporarily on hold.",
      color: "#6b6f76",
      icon: "Ⅱ",
      position: 2,
      isDefault: true,
      projectCount: 0,
    },
    {
      id: "completed",
      key: "completed",
      name: "Completed",
      description: "Projects that have reached their intended outcome.",
      color: "#2e7d32",
      icon: "✓",
      position: 3,
      isDefault: true,
      projectCount: 3,
    },
    {
      id: "canceled",
      key: "canceled",
      name: "Canceled",
      description: "Projects that are no longer planned to continue.",
      color: "#6b6f76",
      icon: "×",
      position: 4,
      isDefault: true,
      projectCount: 0,
    },
  ],
  totalProjects: 6,
  readOnly: false,
  customStatusesSupported: true,
  canManage: true,
  limitation:
    "Custom project statuses are configurable in settings; project records still store the default lifecycle values.",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(input.toString(), "http://localhost").pathname;
}

describe("ProjectStatusesPage component", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads and renders editable lifecycle statuses with workspace counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(statusPayload)),
    );

    render(<ProjectStatusesPage />);

    expect(screen.getByText("Loading project statuses...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.queryByText("Loading project statuses..."),
      ).not.toBeInTheDocument();
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(requestPath(fetchMock.mock.calls[0][0])).toBe(
      "/api/project-statuses",
    );
    expect(screen.getByText("Project statuses")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Planned")).toBeInTheDocument();
    expect(screen.getByDisplayValue("In progress")).toBeInTheDocument();
    expect(screen.getByText("started")).toBeInTheDocument();
    expect(
      screen.getByText(
        /6 workspace projects counted across the configured lifecycle/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New status" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("creates, edits, saves, and renders the persisted custom status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(statusPayload))
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        const request = input as Request;
        const body = (await request.clone().json()) as {
          statuses: typeof statusPayload.statuses;
        };
        return jsonResponse({
          ...statusPayload,
          statuses: body.statuses.map((status, position) => ({
            ...status,
            position,
            projectCount: status.projectCount ?? 0,
          })),
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ProjectStatusesPage />);
    await waitFor(() => screen.getByDisplayValue("Planned"));

    await user.click(screen.getByRole("button", { name: "New status" }));
    const newStatusInput = screen.getByDisplayValue("New status");
    await user.clear(newStatusInput);
    await user.type(newStatusInput, "Blocked");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => screen.getByText("Project statuses saved."));

    const [lastRequest] = fetchMock.mock.calls.at(-1) ?? [];
    expect(requestPath(lastRequest as RequestInfo | URL)).toBe(
      "/api/project-statuses",
    );
    expect((lastRequest as Request).method).toBe("PATCH");
    const requestBody = (await (lastRequest as Request).clone().json()) as {
      statuses: typeof statusPayload.statuses;
    };
    expect(requestBody.statuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Blocked" })]),
    );
    expect(screen.getByDisplayValue("Blocked")).toBeInTheDocument();
  });

  it("shows an honest empty-project state while still listing lifecycle statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...statusPayload,
          totalProjects: 0,
          statuses: statusPayload.statuses.map((status) => ({
            ...status,
            projectCount: 0,
          })),
        }),
      ),
    );

    render(<ProjectStatusesPage />);

    await waitFor(() => screen.getByDisplayValue("Planned"));

    expect(
      screen.getByText(/No projects in this workspace yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No custom statuses")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Canceled")).toBeInTheDocument();
  });

  it("hides mutation controls for non-admin users", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ...statusPayload, canManage: false }),
        ),
    );

    render(<ProjectStatusesPage />);
    await waitFor(() => screen.getByDisplayValue("Planned"));

    expect(
      screen.queryByRole("button", { name: "New status" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Planned")).toBeDisabled();
  });

  it("shows an API error without rendering stale counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401)),
    );

    render(<ProjectStatusesPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Unauthorized");
    });

    expect(screen.queryByDisplayValue("Planned")).not.toBeInTheDocument();
  });

  it("falls back to a generic API error when the server body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 })),
    );

    render(<ProjectStatusesPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Unable to load project statuses.",
      );
    });
  });
});
