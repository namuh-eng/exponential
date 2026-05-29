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
  body: Record<string, unknown> = { providers: { google: true } },
) {
  return { ok: true, json: async () => body };
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

  it("renders the first-party Go auth login surface", async () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: "Log in to exponential" }),
    ).toBeDefined();
    expect(
      screen.getByText(/Authentication is handled by the headless Go API/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeDefined();
    expect(screen.getByPlaceholderText("Email address")).toBeDefined();
    expect(screen.getByPlaceholderText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Log in" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send magic link instead" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/provider-capabilities?callbackUrl=%2Finbox",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
  });

  it("starts Google OAuth through the first-party Go API with the default app callback", async () => {
    fetchMock.mockResolvedValueOnce(providerCapabilities());

    render(<LoginPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "/api/auth/google/start?callback_url=%2Finbox",
      );
    });
  });

  it("starts Google OAuth through the first-party Go API with a safe callback", async () => {
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC";
    fetchMock.mockResolvedValueOnce(providerCapabilities());

    render(<LoginPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "/api/auth/google/start?callback_url=%2Fteam%2FABC",
      );
    });
  });

  it("shows password login as not configured", async () => {
    fetchMock.mockResolvedValueOnce(providerCapabilities());

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Password login is not configured yet. Use Google or magic link.",
        ),
      ).toBeDefined();
    });
  });

  it("requests a first-party magic link and shows the email confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(providerCapabilities())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send magic link instead" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/auth/magic-link",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "person@example.com",
            callbackURL: "/inbox",
          }),
        }),
      );
      expect(
        screen.getByText("Check your email for the sign-in link."),
      ).toBeDefined();
    });
  });

  it("shows SAML when workspace policy disables Google and email/passkey", async () => {
    fetchMock.mockResolvedValueOnce(
      providerCapabilities({
        providers: {
          google: false,
          googleAllowed: false,
          emailPasskey: false,
          passkey: false,
        },
      }),
    );

    render(<LoginPage />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Continue with Google" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Continue with SAML SSO" }),
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

  it("renders the first-party Go auth signup surface", () => {
    render(<SignupPage />);

    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeDefined();
    expect(screen.getByPlaceholderText("Your name")).toBeDefined();
    expect(screen.getByPlaceholderText("Email address")).toBeDefined();
    expect(screen.getByPlaceholderText("Password")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDefined();
  });

  it("shows signup password registration as not configured", async () => {
    fetchMock.mockResolvedValueOnce(providerCapabilities());

    render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("Your name"), {
      target: { value: "Person Example" },
    });
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Password login is not configured yet. Use Google or magic link.",
        ),
      ).toBeDefined();
    });
  });
});
