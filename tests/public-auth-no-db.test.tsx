import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/auth", () => {
  throw new Error("public auth pages must not import server auth/session code");
});

vi.mock("@/lib/db", () => {
  throw Object.assign(
    new Error("connect ECONNREFUSED 127.0.0.1:5432 from public auth page"),
    { code: "ECONNREFUSED" },
  );
});

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    social: vi.fn(),
    magicLink: vi.fn(() => Promise.resolve()),
  },
  signInWithPasskey: vi.fn(),
  browserSupportsPasskeys: vi.fn(() => true),
  enrollPasskey: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, isPending: false })),
  authClient: {},
}));

describe("public auth pages without a database", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: { google: true, passkey: true } }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the branded login page without resolving Postgres-backed session state", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");

    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "Linear logo" })).toBeDefined();
    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
    expect(screen.queryByText(/Internal Server Error/i)).toBeNull();
  });

  it("renders the branded signup page without resolving Postgres-backed session state", async () => {
    const { default: SignupPage } = await import("@/app/(auth)/signup/page");

    render(<SignupPage />);

    expect(
      screen.getByRole("heading", { name: "Create your workspace" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "Linear logo" })).toBeDefined();
    expect(screen.getByText("Already have an account?")).toBeDefined();
    expect(screen.queryByText(/Internal Server Error/i)).toBeNull();
  });
});
