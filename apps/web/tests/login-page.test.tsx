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

function kratosFlow(
  action = "http://localhost:4433/self-service/login?flow=abc",
) {
  return {
    ok: true,
    json: async () => ({
      id: "flow-id",
      ui: {
        action,
        nodes: [{ attributes: { name: "csrf_token", value: "csrf" } }],
      },
    }),
  };
}

function kratosSuccess(redirect = "http://localhost:7015/team/ABC") {
  return { ok: true, json: async () => ({ redirect_browser_to: redirect }) };
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

  it("renders the Kratos-owned login surface", async () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeDefined();
    expect(
      screen.getByText(/Authentication is handled by Ory Kratos/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeDefined();
    expect(screen.getByPlaceholderText("Email address")).toBeDefined();
    expect(screen.getByPlaceholderText("Password")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Log in with Kratos" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send magic link instead" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/provider-capabilities",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
  });

  it("starts Google OAuth through the Kratos browser flow with a safe callback", async () => {
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC";
    fetchMock
      .mockResolvedValueOnce(providerCapabilities())
      .mockResolvedValueOnce(kratosFlow())
      .mockResolvedValueOnce(kratosSuccess("http://localhost:7015/team/ABC"));

    render(<LoginPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/auth/kratos/self-service/login/browser?return_to=http%3A%2F%2Flocalhost%3A7015%2Fteam%2FABC",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/auth/kratos/self-service/login?flow=abc",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            method: "oidc",
            provider: "google",
            csrf_token: "csrf",
          }),
        }),
      );
      expect(assignMock).toHaveBeenCalledWith("/team/ABC");
    });
  });

  it("submits password login to Kratos", async () => {
    fetchMock
      .mockResolvedValueOnce(providerCapabilities())
      .mockResolvedValueOnce(kratosFlow())
      .mockResolvedValueOnce(kratosSuccess("http://localhost:7015/"));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in with Kratos" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/auth/kratos/self-service/login?flow=abc",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            method: "password",
            identifier: "person@example.com",
            password: "correct horse battery staple",
            csrf_token: "csrf",
          }),
        }),
      );
      expect(assignMock).toHaveBeenCalledWith("/");
    });
  });

  it("requests a Kratos magic link and shows the email confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(providerCapabilities())
      .mockResolvedValueOnce(kratosFlow())
      .mockResolvedValueOnce(kratosSuccess("http://localhost:7015/"));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send magic link instead" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/auth/kratos/self-service/login?flow=abc",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            method: "link",
            identifier: "person@example.com",
            csrf_token: "csrf",
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

  it("renders the Kratos-owned signup surface", () => {
    render(<SignupPage />);

    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeDefined();
    expect(screen.getByPlaceholderText("Your name")).toBeDefined();
    expect(screen.getByPlaceholderText("Email address")).toBeDefined();
    expect(screen.getByPlaceholderText("Password")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Sign up with Kratos" }),
    ).toBeDefined();
  });

  it("submits Kratos password registration with traits", async () => {
    fetchMock
      .mockResolvedValueOnce(providerCapabilities())
      .mockResolvedValueOnce(
        kratosFlow("http://localhost:4433/self-service/registration?flow=abc"),
      )
      .mockResolvedValueOnce(kratosSuccess("http://localhost:7015/"));

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
    fireEvent.click(
      screen.getByRole("button", { name: "Sign up with Kratos" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/auth/kratos/self-service/registration/browser?return_to=http%3A%2F%2Flocalhost%3A7015%2F",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/auth/kratos/self-service/registration?flow=abc",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            method: "password",
            password: "correct horse battery staple",
            traits: { email: "person@example.com", name: "Person Example" },
            csrf_token: "csrf",
          }),
        }),
      );
    });
  });
});
