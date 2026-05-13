import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, isPending: false })),
  authClient: {},
}));

describe("public auth pages without a database", () => {
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
      screen.getByRole("button", { name: /Continue with Google/i }),
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
