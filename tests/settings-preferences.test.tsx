import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import PreferencesPage from "@/app/(app)/settings/account/preferences/page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings/account/preferences",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

describe("Account Preferences Page", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(window, "localStorage", {
      writable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        clear: vi.fn(() => {
          storage.clear();
        }),
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/account/preferences" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            accountPreferences: {
              defaultHomeView: "inbox",
              theme: "system",
              sidebarBadgeStyle: "count",
              sidebarVisibility: {
                inbox: true,
                myIssues: true,
                projects: true,
                views: true,
                initiatives: true,
                cycles: true,
              },
            },
          }),
        } as Response;
      }

      if (url === "/api/account/preferences" && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => JSON.parse(String(init.body)),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
    document.documentElement.className = "";
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.fontSize = "default";
    document.documentElement.dataset.pointerCursors = "false";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Preferences heading", async () => {
    render(<PreferencesPage />);
    expect(
      screen.getByRole("heading", { name: "Preferences" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Inbox")).toBeInTheDocument();
    });
  });

  it("renders General section with home view setting", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Default home view")).toBeInTheDocument();
  });

  it("renders Display names combobox", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Display names")).toBeInTheDocument();
  });

  it("renders First day of week setting", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("First day of week")).toBeInTheDocument();
  });

  it("renders Convert emoticons toggle", () => {
    render(<PreferencesPage />);
    expect(
      screen.getByText("Convert text emoticons into emojis"),
    ).toBeInTheDocument();
  });

  it("renders Send comment shortcut setting", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Send comment on…")).toBeInTheDocument();
  });

  it("renders Interface and theme section", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Interface and theme")).toBeInTheDocument();
  });

  it("renders theme selector with System/Light/Dark options", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Interface theme")).toBeInTheDocument();
    expect(screen.getByText("System preference")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("renders App sidebar customize control and coding tools link", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("App sidebar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Customize sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Configure coding tools settings" }),
    ).toHaveAttribute("href", "/settings/account/agents");
  });

  it("renders Font size setting", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Font size")).toBeInTheDocument();
  });

  it("renders Pointer cursors toggle", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Use pointer cursors")).toBeInTheDocument();
  });

  it("renders Desktop application section", () => {
    render(<PreferencesPage />);
    expect(screen.getByText("Desktop application")).toBeInTheDocument();
    expect(screen.getByText("Open in desktop app")).toBeInTheDocument();
  });

  it("applies and persists the selected theme", async () => {
    render(<PreferencesPage />);

    fireEvent.click(screen.getByText("Light"));

    await waitFor(() => {
      expect(window.localStorage.getItem("whetline-theme")).toBe("light");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("opens the sidebar customization modal", () => {
    render(<PreferencesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));

    expect(
      screen.getByRole("dialog", { name: "Customize sidebar" }),
    ).toBeInTheDocument();
  });
});
