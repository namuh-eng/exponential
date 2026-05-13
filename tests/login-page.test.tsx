import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const assignMock = vi.fn();
const fetchMock = vi.fn();
const mockLocation = {
  ...window.location,
  assign: assignMock,
  origin: "http://localhost:3015",
  search: "",
};

vi.stubGlobal("location", mockLocation);
vi.stubGlobal("fetch", fetchMock);

import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";
import { signIn, signInWithPasskey } from "@/lib/auth-client";

describe("Login page", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: { google: true, passkey: true } }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    assignMock.mockReset();
    mockLocation.pathname = "/login";
    mockLocation.search = "";
    Object.defineProperty(window.navigator, "credentials", {
      value: undefined,
      configurable: true,
    });
  });

  it("renders the login title", () => {
    render(<LoginPage />);
    expect(screen.getByText("Log in to Linear")).toBeDefined();
  });

  it("shows Continue with Google button", async () => {
    render(<LoginPage />);
    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
  });

  it("shows Continue with email button", () => {
    render(<LoginPage />);
    expect(screen.getByText("Continue with email")).toBeDefined();
  });

  it("matches Linear's login auth method surface", async () => {
    render(<LoginPage />);
    await screen.findByRole("button", { name: /Continue with Google/i });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim()),
    ).toEqual([
      "Continue with Google",
      "Continue with email",
      "Continue with SAML SSO",
      "Log in with passkey",
    ]);
    expect(
      screen.getByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with SAML SSO/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Log in with passkey/i }),
    ).toBeDefined();
  });

  it("matches Linear's focused SAML email step from the login chooser", () => {
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Continue with SAML SSO/i }),
    );

    expect(screen.getByText("What’s your email address?")).toBeDefined();
    const samlInput = screen.getByPlaceholderText("Enter your email address…");
    expect(samlInput).toBeDefined();
    expect(samlInput.getAttribute("type")).toBe("email");
    expect(
      screen.getByRole("button", { name: "Continue with SAML" }),
    ).toBeDefined();
    expect(screen.getByText("Back to login")).toBeDefined();
  });

  it("matches Linear's passkey waiting state while WebAuthn is pending", async () => {
    vi.mocked(signInWithPasskey).mockReturnValueOnce(new Promise(() => {}));
    render(<LoginPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Log in with passkey/i }),
    );

    expect(signInWithPasskey).toHaveBeenCalledWith({
      callbackURL: "http://localhost:3015/",
    });
    expect(
      screen
        .getByRole("button", { name: /Waiting for passkey/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("starts WebAuthn and recovers when passkey login is rejected", async () => {
    const credentialsGet = vi.fn(() =>
      Promise.reject(new DOMException("User canceled", "NotAllowedError")),
    );
    Object.defineProperty(window.navigator, "credentials", {
      value: { get: credentialsGet },
      configurable: true,
    });
    vi.mocked(signInWithPasskey).mockImplementationOnce(
      async ({ callbackURL }) => {
        await navigator.credentials.get({
          publicKey: { challenge: new Uint8Array([1, 2, 3]) },
        });
        return { redirectTo: callbackURL };
      },
    );
    render(<LoginPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Log in with passkey/i }),
    );

    await vi.waitFor(() => {
      expect(credentialsGet).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: /Log in with passkey/i }),
      ).toBeDefined();
      expect(
        screen.getByText(
          "Passkey sign-in failed. Try again or use another method.",
        ),
      ).toBeDefined();
    });
    expect(
      screen
        .getByRole("button", { name: /Log in with passkey/i })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("calls signIn.social with google provider on Google click", async () => {
    render(<LoginPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );
    await vi.waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "http://localhost:3015/",
      });
    });
  });

  it("starts Google OAuth and uses the callbackUrl query param for Google sign-in", async () => {
    vi.mocked(signIn.social).mockResolvedValueOnce({
      data: {
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
        redirect: true,
      },
    });
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC%2Fboard";
    render(<LoginPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );
    await vi.waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "http://localhost:3015/team/ABC/board",
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
      );
    });
  });

  it("uses the current workspace deep-link URL for Google sign-in when login is rendered by rewrite", async () => {
    mockLocation.pathname = "/foreverbrowsing/settings/account/security";
    mockLocation.search = "?tab=sessions";
    render(<LoginPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );
    await vi.waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL:
          "http://localhost:3015/foreverbrowsing/settings/account/security?tab=sessions",
      });
    });
  });

  it("sanitizes explicit callbackUrl values before falling back to the rewritten workspace URL", async () => {
    mockLocation.pathname = "/foreverbrowsing/projects";
    mockLocation.search = "?callbackUrl=https%3A%2F%2Fevil.example%2Fphish";
    render(<LoginPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );
    await vi.waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL:
          "http://localhost:3015/foreverbrowsing/projects?callbackUrl=https%3A%2F%2Fevil.example%2Fphish",
      });
    });
  });

  it("does not show a Google configuration warning on initial login load when Google is unavailable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ providers: { google: false } }),
    });

    render(<LoginPage />);

    const button = await screen.findByRole("button", {
      name: /Continue with Google/i,
    });

    expect(button.hasAttribute("disabled")).toBe(false);
    expect(
      screen.queryByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toBeNull();
    expect(signIn.social).not.toHaveBeenCalled();
  });

  it("does not show a Google configuration warning on initial workspace login load", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ providers: { google: false } }),
    });
    mockLocation.pathname = "/foreverbrowsing/inbox";

    render(<LoginPage />);

    await screen.findByRole("button", { name: /Continue with Google/i });

    expect(
      screen.queryByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toBeNull();
    expect(signIn.social).not.toHaveBeenCalled();
  });

  it("shows a visible Google error after clicking Google when Google is not configured", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ providers: { google: false } }),
    });
    render(<LoginPage />);

    const button = await screen.findByRole("button", {
      name: /Continue with Google/i,
    });
    fireEvent.click(button);

    expect(
      screen.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toBeDefined();
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(signIn.social).not.toHaveBeenCalled();
  });

  it("shows a visible Google error and clears loading when Better Auth reports a missing provider", async () => {
    vi.mocked(signIn.social).mockResolvedValueOnce({
      error: {
        code: "PROVIDER_NOT_FOUND",
        status: 404,
        message: "Provider not found",
      },
    });
    render(<LoginPage />);

    const button = await screen.findByRole("button", {
      name: /Continue with Google/i,
    });
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(
        screen.getByText(
          "Google sign-in is not configured. Use email or SAML SSO instead.",
        ),
      ).toBeDefined();
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  it("matches Linear's focused login email step", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    expect(
      screen.getByRole("heading", { name: "What’s your email address?" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Log in to Linear" }),
    ).toBeNull();
    expect(
      screen.getByPlaceholderText("Enter your email address…"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Back to login" })).toBeDefined();
    expect(screen.queryByText("Back to login options")).toBeNull();
  });

  it("returns to choose step when clicking back", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));
    fireEvent.click(screen.getByText("Back to login"));
    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
  });

  it("shows email-sent step after submitting email", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "test@example.com" } });

    const form = input.closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(screen.getByText("Check your email")).toBeDefined();
    });
    expect(screen.getByPlaceholderText("Enter 6-digit code")).toBeDefined();

    expect(signIn.magicLink).toHaveBeenCalledWith({
      email: "test@example.com",
      callbackURL: "http://localhost:3015/",
      errorCallbackURL: "http://localhost:3015/login",
    });
  });

  it("preserves callbackUrl when requesting a magic link", async () => {
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC%2Fboard";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "test@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(signIn.magicLink).toHaveBeenCalledWith({
        email: "test@example.com",
        callbackURL: "http://localhost:3015/team/ABC/board",
        errorCallbackURL:
          "http://localhost:3015/login?callbackUrl=%2Fteam%2FABC%2Fboard",
      });
    });
  });

  it("preserves callbackUrl query params when requesting a magic link", async () => {
    mockLocation.search =
      "?callbackUrl=%2Faccept-invite%3Ftoken%3Dsigned-token";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "invitee@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(signIn.magicLink).toHaveBeenCalledWith({
        email: "invitee@example.com",
        callbackURL: "http://localhost:3015/accept-invite?token=signed-token",
        errorCallbackURL:
          "http://localhost:3015/login?callbackUrl=%2Faccept-invite%3Ftoken%3Dsigned-token",
      });
    });
  });

  it("uses the current workspace root URL when requesting a magic link from a rewritten login", async () => {
    mockLocation.pathname = "/foreverbrowsing";
    mockLocation.search = "";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "test@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(signIn.magicLink).toHaveBeenCalledWith({
        email: "test@example.com",
        callbackURL: "http://localhost:3015/foreverbrowsing",
        errorCallbackURL: "http://localhost:3015/foreverbrowsing",
      });
    });
  });

  it("uses the current workspace deep-link URL when requesting a magic link from a rewritten login", async () => {
    mockLocation.pathname = "/foreverbrowsing/team/ENG/all";
    mockLocation.search = "?view=list&error=INVALID_TOKEN";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "test@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(signIn.magicLink).toHaveBeenCalledWith({
        email: "test@example.com",
        callbackURL:
          "http://localhost:3015/foreverbrowsing/team/ENG/all?view=list",
        errorCallbackURL:
          "http://localhost:3015/foreverbrowsing/team/ENG/all?view=list",
      });
    });
  });

  it("matches Linear's login footer copy", () => {
    const { container } = render(<LoginPage />);

    expect(container.textContent).toContain(
      "Don’t have an account? Sign up or learn more",
    );
    expect(screen.getByText("Sign up")).toBeDefined();
    const learnMore = screen.getByText("learn more");
    expect(learnMore).toBeDefined();
    expect(learnMore.getAttribute("href")).toBe("https://linear.app/homepage");
    expect(screen.queryByText("Terms of Service")).toBeNull();
    expect(screen.queryByText("Privacy Policy")).toBeNull();
  });

  it("shows error when magic link fails", async () => {
    vi.mocked(signIn.magicLink).mockRejectedValueOnce(new Error("fail"));
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "bad@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(
        screen.getByText("Failed to send magic link. Please try again."),
      ).toBeDefined();
    });
  });

  it("allows returning from email-sent to choose step", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "test@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByText("Check your email")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Use a different method"));
    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
  });

  it("displays the submitted email in confirmation", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const input = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(input, { target: { value: "hello@linear.app" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByText("hello@linear.app")).toBeDefined();
    });
  });

  it("navigates to magic-link verification when a valid code is submitted", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const emailInput = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.submit(emailInput.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText("Enter 6-digit code")).toBeDefined();
    });

    const codeInput = screen.getByPlaceholderText("Enter 6-digit code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.submit(codeInput.closest("form") as HTMLFormElement);

    expect(assignMock).toHaveBeenCalledWith(
      "http://localhost:3015/api/auth/magic-link/verify?token=123456&callbackURL=http%3A%2F%2Flocalhost%3A3015%2F&errorCallbackURL=http%3A%2F%2Flocalhost%3A3015%2Flogin",
    );
  });

  it("preserves callbackUrl when verifying a valid code", async () => {
    mockLocation.search = "?callbackUrl=%2Fteam%2FABC%2Fboard";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const emailInput = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.submit(emailInput.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText("Enter 6-digit code")).toBeDefined();
    });

    const codeInput = screen.getByPlaceholderText("Enter 6-digit code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.submit(codeInput.closest("form") as HTMLFormElement);

    expect(assignMock).toHaveBeenCalledWith(
      "http://localhost:3015/api/auth/magic-link/verify?token=123456&callbackURL=http%3A%2F%2Flocalhost%3A3015%2Fteam%2FABC%2Fboard&errorCallbackURL=http%3A%2F%2Flocalhost%3A3015%2Flogin%3FcallbackUrl%3D%252Fteam%252FABC%252Fboard",
    );
  });

  it("preserves callbackUrl query params when verifying a valid code", async () => {
    mockLocation.search =
      "?callbackUrl=%2Faccept-invite%3Ftoken%3Dsigned-token";
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Continue with email"));

    const emailInput = screen.getByPlaceholderText("Enter your email address…");
    fireEvent.change(emailInput, { target: { value: "invitee@example.com" } });
    fireEvent.submit(emailInput.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText("Enter 6-digit code")).toBeDefined();
    });

    const codeInput = screen.getByPlaceholderText("Enter 6-digit code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.submit(codeInput.closest("form") as HTMLFormElement);

    expect(assignMock).toHaveBeenCalledWith(
      "http://localhost:3015/api/auth/magic-link/verify?token=123456&callbackURL=http%3A%2F%2Flocalhost%3A3015%2Faccept-invite%3Ftoken%3Dsigned-token&errorCallbackURL=http%3A%2F%2Flocalhost%3A3015%2Flogin%3FcallbackUrl%3D%252Faccept-invite%253Ftoken%253Dsigned-token",
    );
  });

  it("renders the signup variant", () => {
    render(<SignupPage />);
    expect(screen.getByText("Create your workspace")).toBeDefined();
    expect(screen.getByText("Already have an account?")).toBeDefined();
    expect(screen.getByText("Log in")).toBeDefined();
    expect(screen.getByText("Terms of Service")).toBeDefined();
    expect(screen.getByText("Data Processing Agreement")).toBeDefined();
  });

  it("matches Linear's signup auth method surface", async () => {
    render(<SignupPage />);
    await screen.findByRole("button", { name: /Continue with Google/i });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim()),
    ).toEqual([
      "Continue with Google",
      "Continue with email",
      "Continue with SAML SSO",
    ]);
    expect(
      screen.getByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with SAML SSO/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Log in with passkey/i }),
    ).toBeNull();
  });

  it("starts Google OAuth from signup with a safe local callback", async () => {
    vi.mocked(signIn.social).mockResolvedValueOnce({
      data: {
        url: "https://accounts.google.com/o/oauth2/v2/auth?signup=1",
        redirect: true,
      },
    });
    mockLocation.pathname = "/signup";
    mockLocation.search = "?callbackUrl=https%3A%2F%2Fevil.example%2Fphish";
    render(<SignupPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );

    await vi.waitFor(() => {
      expect(signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "http://localhost:3015/",
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?signup=1",
      );
    });
  });

  it("matches Linear's focused signup email step", () => {
    const { container } = render(<SignupPage />);

    fireEvent.click(screen.getByText("Continue with email"));

    expect(screen.getByText("What’s your email address?")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Enter your email address…"),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Continue with email" }),
    ).toBeDefined();
    expect(screen.getByText("Back to signup")).toBeDefined();
    expect(screen.queryByText("Already have an account?")).toBeNull();
    expect(screen.queryByText("Terms of Service")).toBeNull();
    expect(
      container.querySelector('input[name="cf-turnstile-response"]'),
    ).toBeDefined();
  });

  it("matches Linear's focused signup SAML step", async () => {
    render(<SignupPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Continue with SAML SSO/i }),
    );

    expect(screen.getByText("What’s your email address?")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Enter your email address…"),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Continue with SAML" }),
    ).toBeDefined();
    expect(screen.getByText("Back to signup")).toBeDefined();
    expect(screen.queryByText("Already have an account?")).toBeNull();
    expect(screen.queryByText("Terms of Service")).toBeNull();

    fireEvent.click(screen.getByText("Back to signup"));
    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with email/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Continue with SAML SSO/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Log in with passkey/i }),
    ).toBeNull();
  });
});
