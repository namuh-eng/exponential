import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sesSendMock,
  SESv2ClientMock,
  SendEmailCommandMock,
  opensendSendMock,
  OpensendMock,
} = vi.hoisted(() => {
  const sesSendMock = vi.fn<(cmd: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ MessageId: "test-msg-id" }),
  );
  class SESv2ClientMock {
    send = sesSendMock;
  }
  class SendEmailCommandMock {
    constructor(input: unknown) {
      Object.assign(this, input as Record<string, unknown>);
    }
  }

  const opensendSendMock = vi.fn<
    (payload: Record<string, unknown>) => Promise<unknown>
  >(() => Promise.resolve({ data: { id: "os-1" }, error: null }));
  class OpensendMock {
    public readonly emails = { send: opensendSendMock };
    constructor(
      public readonly apiKey: string,
      public readonly options: { baseUrl?: string } = {},
    ) {}
  }

  return {
    sesSendMock,
    SESv2ClientMock,
    SendEmailCommandMock,
    opensendSendMock,
    OpensendMock,
  };
});

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: SESv2ClientMock,
  SendEmailCommand: SendEmailCommandMock,
}));

vi.mock("opensend", () => ({ Opensend: OpensendMock }));

function getLastSesCommand(): Record<string, unknown> {
  return sesSendMock.mock.lastCall?.[0] as Record<string, unknown>;
}

function getLastOpensendPayload(): Record<string, unknown> {
  return opensendSendMock.mock.lastCall?.[0] as Record<string, unknown>;
}

describe("Email utilities", () => {
  let emailModule: typeof import("@/lib/email");
  let previewDir: string;

  beforeEach(async () => {
    sesSendMock.mockClear();
    opensendSendMock.mockClear();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("SENDER_EMAIL", "test@example.com");
    vi.stubEnv("NODE_ENV", "test");
    previewDir = fs.mkdtempSync(path.join(os.tmpdir(), "email-preview-"));
    vi.stubEnv("EMAIL_PREVIEW_PATH", path.join(previewDir, "latest.json"));
    emailModule = await import("@/lib/email");
  });

  it("isEmailEnabled is true when SENDER_EMAIL is set", () => {
    expect(emailModule.isEmailEnabled()).toBe(true);
  });

  it("isEmailEnabled is false when no provider env is set", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    emailModule = await import("@/lib/email");
    expect(emailModule.isEmailEnabled()).toBe(false);
  });

  it("sendEmail sends via SES with correct structure", async () => {
    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Test Subject",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).resolves.toBe("sent");

    expect(sesSendMock).toHaveBeenCalledOnce();
    expect(getLastSesCommand()).toMatchObject({
      FromEmailAddress: "test@example.com",
      Destination: { ToAddresses: ["user@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Test Subject" },
          Body: {
            Html: { Data: "<p>Hello</p>" },
            Text: { Data: "Hello" },
          },
        },
      },
    });
  });

  it("sendEmail works without text body", async () => {
    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "HTML Only",
        html: "<p>Hello</p>",
      }),
    ).resolves.toBe("sent");

    expect(sesSendMock).toHaveBeenCalledOnce();
    const cmd = getLastSesCommand() as {
      Content: { Simple: { Body: { Html: { Data: string }; Text?: unknown } } };
    };
    expect(cmd.Content.Simple.Body.Html).toEqual({ Data: "<p>Hello</p>" });
    expect(cmd.Content.Simple.Body.Text).toBeUndefined();
  });

  it("sendEmail returns 'disabled' when no provider is configured", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Nope",
        html: "<p>Hello</p>",
      }),
    ).resolves.toBe("disabled");

    expect(sesSendMock).not.toHaveBeenCalled();
    expect(opensendSendMock).not.toHaveBeenCalled();
  });

  it("sendEmail uses Opensend when OPENSEND_API_KEY is set", async () => {
    vi.stubEnv("OPENSEND_API_KEY", "os_test_key");
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Via Opensend",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    ).resolves.toBe("sent");

    expect(opensendSendMock).toHaveBeenCalledOnce();
    expect(sesSendMock).not.toHaveBeenCalled();
    expect(getLastOpensendPayload()).toMatchObject({
      from: "test@example.com",
      to: "user@example.com",
      subject: "Via Opensend",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("EMAIL_PROVIDER=opensend selects Opensend even when both envs are set", async () => {
    vi.stubEnv("OPENSEND_API_KEY", "os_key");
    vi.stubEnv("EMAIL_PROVIDER", "opensend");
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await emailModule.sendEmail({
      to: "user@example.com",
      subject: "Explicit",
      html: "<p>Hi</p>",
    });

    expect(opensendSendMock).toHaveBeenCalledOnce();
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("Opensend provider surfaces API errors as thrown errors", async () => {
    vi.stubEnv("OPENSEND_API_KEY", "os_key");
    vi.resetModules();
    emailModule = await import("@/lib/email");
    opensendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited", statusCode: 429 },
    });

    await expect(
      emailModule.sendEmail(
        {
          to: "user@example.com",
          subject: "Errors propagate",
          html: "<p>Hi</p>",
        },
        { allowPreviewFallback: false },
      ),
    ).rejects.toThrow(/rate limited/);
  });

  it("sendMagicLinkEmail includes code and link", async () => {
    await emailModule.sendMagicLinkEmail(
      "user@example.com",
      "123456",
      "https://app.example.com/verify?token=abc",
    );

    expect(sesSendMock).toHaveBeenCalledOnce();
    const cmd = getLastSesCommand() as {
      Content: {
        Simple: { Subject: { Data: string }; Body: { Html: { Data: string } } };
      };
    };
    expect(cmd.Content.Simple.Subject.Data).toContain("123456");
    expect(cmd.Content.Simple.Body.Html.Data).toContain("123456");
    expect(cmd.Content.Simple.Body.Html.Data).toContain(
      "https://app.example.com/verify?token=abc",
    );
  });

  it("sendMagicLinkEmail returns 'disabled' when email is not configured", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await expect(
      emailModule.sendMagicLinkEmail(
        "user@example.com",
        "123456",
        "https://app.example.com/verify",
      ),
    ).resolves.toBe("disabled");
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("writes a local preview instead of failing in non-production when SES send errors", async () => {
    sesSendMock.mockRejectedValueOnce(new Error("session expired"));

    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Preview me",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).resolves.toBe("preview");

    const preview = JSON.parse(
      fs.readFileSync(path.join(previewDir, "latest.json"), "utf8"),
    ) as {
      to: string;
      subject: string;
      error: string;
      provider: string;
    };

    expect(preview.provider).toBe("ses-preview");
    expect(preview.to).toBe("user@example.com");
    expect(preview.subject).toBe("Preview me");
    expect(preview.error).toContain("session expired");
  });

  it("supports disabling preview fallback in non-production", async () => {
    sesSendMock.mockRejectedValueOnce(new Error("ses unavailable"));

    await expect(
      emailModule.sendEmail(
        {
          to: "user@example.com",
          subject: "Must fail locally",
          html: "<p>Hello</p>",
        },
        { allowPreviewFallback: false },
      ),
    ).rejects.toThrow("ses unavailable");
  });

  it("still throws SES errors in production", async () => {
    sesSendMock.mockRejectedValueOnce(new Error("production send failed"));
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Must fail",
        html: "<p>Hello</p>",
      }),
    ).rejects.toThrow("production send failed");
  });

  it("sendInvitationEmail includes workspace name and inviter", async () => {
    await emailModule.sendInvitationEmail(
      "invitee@example.com",
      "Acme Corp",
      "John",
      "https://app.example.com/invite/xyz",
    );

    expect(sesSendMock).toHaveBeenCalledOnce();
    const cmd = getLastSesCommand() as {
      Content: {
        Simple: { Subject: { Data: string }; Body: { Html: { Data: string } } };
      };
    };
    expect(cmd.Content.Simple.Subject.Data).toContain("John");
    expect(cmd.Content.Simple.Subject.Data).toContain("Acme Corp");
    expect(cmd.Content.Simple.Body.Html.Data).toContain("Acme Corp");
    expect(cmd.Content.Simple.Body.Html.Data).toContain(
      "https://app.example.com/invite/xyz",
    );
  });

  it("sendInvitationEmail fails when SES delivery fails", async () => {
    sesSendMock.mockRejectedValueOnce(new Error("invite delivery failed"));

    await expect(
      emailModule.sendInvitationEmail(
        "invitee@example.com",
        "Acme Corp",
        "John",
        "https://app.example.com/invite/xyz",
      ),
    ).rejects.toThrow("invite delivery failed");
  });

  it("sendNotificationEmail includes body and action link", async () => {
    await emailModule.sendNotificationEmail(
      "user@example.com",
      "Issue assigned",
      "You were assigned ENG-123",
      "https://app.example.com/issue/ENG-123",
    );

    expect(sesSendMock).toHaveBeenCalledOnce();
    const cmd = getLastSesCommand() as {
      Content: { Simple: { Body: { Html: { Data: string } } } };
    };
    expect(cmd.Content.Simple.Body.Html.Data).toContain(
      "https://app.example.com/issue/ENG-123",
    );
  });
});
