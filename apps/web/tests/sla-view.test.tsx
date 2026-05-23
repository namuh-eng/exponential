import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SLAPage from "@/app/(app)/settings/sla/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("SLAPage component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sla: { policies: [], canManage: true } }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the SLA settings page with create controls", async () => {
    render(<SLAPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("SLAs")).toBeInTheDocument();
      expect(screen.getByText("Create SLA policy")).toBeInTheDocument();
      expect(screen.getByText("No SLAs")).toBeInTheDocument();
    });
  });

  it("creates, edits, and deletes SLA policies through the API", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sla: { policies: [], canManage: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          policy: {
            id: "sla-1",
            name: "Urgent customer issues",
            description: "Customer escalation",
            responseTimeHours: 2,
            resolutionTimeHours: 8,
            enabled: true,
            conditions: { priority: "urgent", teamKey: "ENG" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          policy: {
            id: "sla-1",
            name: "High priority issues",
            description: "Customer escalation",
            responseTimeHours: 2,
            resolutionTimeHours: 8,
            enabled: true,
            conditions: { priority: "urgent", teamKey: "ENG" },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    render(<SLAPage />);
    await screen.findByText("Create SLA policy");

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Urgent customer issues" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Customer escalation" },
    });
    fireEvent.change(screen.getByLabelText("First response hours"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Resolution hours"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Priority condition"), {
      target: { value: "urgent" },
    });
    fireEvent.change(screen.getByLabelText("Team key"), {
      target: { value: "ENG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create SLA" }));

    expect(
      await screen.findByText("Urgent customer issues"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workspaces/current/sla",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "High priority issues" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save SLA policy" }));

    expect(await screen.findByText("High priority issues")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workspaces/current/sla/sla-1",
      expect.objectContaining({ method: "PATCH" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(
        screen.queryByText("High priority issues"),
      ).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workspaces/current/sla/sla-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
