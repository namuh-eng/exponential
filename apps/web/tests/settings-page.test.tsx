import SettingsPage from "@/app/(app)/settings/page";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();

vi.mock("@/app/(app)/app-shell", () => ({
  useAppShellContext: () => ({ workspaceSlug: "foreverbrowsing" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace }),
}));

describe("Settings root page", () => {
  it("redirects to the slug-prefixed account preferences route", async () => {
    replace.mockClear();

    render(<SettingsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/foreverbrowsing/settings/account/preferences",
      );
    });
  });
});
