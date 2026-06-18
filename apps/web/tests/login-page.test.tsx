import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assignMock = vi.fn();
const fetchMock = vi.fn();
const mockLocation = {
  ...window.location,
  assign: assignMock,
  origin: "http://localhost:7015",
  pathname: "/login",
  search: "",
};

vi.stubGlobal("location", mockLocation);
vi.stubGlobal("fetch", fetchMock);

import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";

function providerCapabilities(
  body: Record<string, unknown> = {
    providers: { google: true, saml: true, oidc: false },
  },
) {
  return { ok: true, json: async () => body };
}

async function waitForProviderProbe(path = "/api/auth/provider-capabilities") {
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ cache: "no-store" }),
    );
  });
}

describe("Login page", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(providerCapabilities());
    mockLocation.pathname = "/login";
    mockLocation.search = "";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    assignMock.mockReset();
  });

  it("renders the first-party Go auth login chooser", async () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: "Log in to exponential" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "exponential logo" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with SSO/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Log in with passkey/ }),
    ).toBeDefined();
    await waitForProviderProbe();
  });

  it("does not leak prototype host/version facts into the login surface", async () => {
    render(<LoginPage />);

    expect(screen.queryByText("v0.4.2")).toBeNull();
    expect(screen.queryByText(/exponential\.local/)).toBeNull();
    expect(screen.queryByText("headless api")).toBeNull();
    expect(screen.queryByText(/live where probed/)).toBeNull();

    await waitForProviderProbe();
  });

  it("keeps the auth surface neutral when provider capability probing fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    render(<LoginPage />);

    expect(screen.queryByText("headless api")).toBeNull();

    await waitForProviderProbe();
  });

  it("starts Google OAuth through the first-party Go API with the default app callback", async () => {
    render(<LoginPage />);
    await waitForProviderProbe();

    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    );

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "/api/auth/google/start?callback_url=%2F",
      );
    });
  });

  it("starts Google OAuth through the first-party Go API with a safe callback", async () => {
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC";

    render(<LoginPage />);
    await waitForProviderProbe(
      "/api/auth/provider-capabilities?callbackUrl=%2Fteam%2FABC",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    );

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "/api/auth/google/start?callback_url=%2Fteam%2FABC",
      );
    });
  });

  it("keeps Google and SSO active while marking email and passkey coming soon", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Continue with email/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Continue with SSO/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Log in with passkey/ }),
    ).toBeDisabled();
    expect(screen.getAllByText("coming soon").length).toBeGreaterThanOrEqual(2);
  });

  it("shows SSO when workspace policy disables Google and email/passkey", async () => {
    fetchMock.mockResolvedValueOnce(
      providerCapabilities({
        providers: {
          google: false,
          googleAllowed: false,
          emailPasskey: false,
          passkey: false,
          saml: true,
          oidc: false,
        },
      }),
    );

    render(<LoginPage />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Continue with Google/ }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Continue with email/ }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Log in with passkey/ }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: /Continue with SSO/ }),
      ).toBeDefined();
    });
  });
});

describe("Signup page", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(providerCapabilities());
    mockLocation.pathname = "/signup";
    mockLocation.search = "";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    assignMock.mockReset();
  });

  it("renders the first-party Go auth signup chooser", () => {
    render(<SignupPage />);

    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "exponential logo" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/ }),
    ).toBeDefined();
    expect(screen.getByText("Already have an account?")).toBeDefined();
  });

  it("keeps signup free of legacy prototype claims", () => {
    render(<SignupPage />);

    expect(screen.queryByText("v0.4.2")).toBeNull();
    expect(screen.queryByText(/exponential\.local/)).toBeNull();
    expect(
      screen.queryByText(/Create-workspace is the next step after signup/),
    ).toBeNull();
    expect(screen.queryByText("password path pending")).toBeNull();
  });

  it("keeps signup legal links first-party", () => {
    render(<SignupPage />);

    const legalLinks = screen
      .getByText(/By signing up/)
      .closest("p")
      ?.querySelectorAll("a");

    expect(
      Array.from(legalLinks ?? []).map((link) => link.getAttribute("href")),
    ).toEqual(["/terms", "/dpa"]);
  });
});
