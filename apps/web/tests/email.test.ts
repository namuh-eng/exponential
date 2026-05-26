import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, SESv2ClientMock, SendEmailCommandMock } = vi.hoisted(() => {
  const sendMock = vi.fn<(cmd: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ MessageId: "test-msg-id" }),
  );
  class SESv2ClientMock {
    send = sendMock;
  }
  class SendEmailCommandMock {
    constructor(input: unknown) {
      Object.assign(this, input as Record<string, unknown>);
    }
  }
  return { sendMock, SESv2ClientMock, SendEmailCommandMock };
});

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: SESv2ClientMock,
  SendEmailCommand: SendEmailCommandMock,
}));

vi.stubEnv("AWS_REGION", "us-east-1");
vi.stubEnv("SENDER_EMAIL", "test@example.com");

function getLastSentCommand(): Record<string, unknown> {
  return sendMock.mock.lastCall?.[0] as Record<string, unknown>;
}

describe("Email utilities", () => {
  let emailModule: typeof import("@/lib/email");
  let previewDir: string;

  beforeEach(async () => {
    sendMock.mockClear();
    vi.resetModules();
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("SENDER_EMAIL", "test@example.com");
    vi.stubEnv("NODE_ENV", "test");
    previewDir = fs.mkdtempSync(path.join(os.tmpdir(), "email-preview-"));
    vi.stubEnv("EMAIL_PREVIEW_PATH", path.join(previewDir, "latest.json"));
    emailModule = await import("@/lib/email");
  });

  it("exports ses client", () => {
    expect(emailModule.ses).toBeDefined();
  });

  it("sendEmail sends via SES with correct structure", async () => {
    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Test Subject",
        html: "<p>Hello</p>",
        text: "Hello",
      }),
    ).resolves.toBe("ses");

    expect(sendMock).toHaveBeenCalledOnce();
    expect(getLastSentCommand()).toMatchObject({
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
    ).resolves.toBe("ses");

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = getLastSentCommand() as {
      Content: { Simple: { Body: { Html: { Data: string }; Text?: unknown } } };
    };
    expect(cmd.Content.Simple.Body.Html).toEqual({ Data: "<p>Hello</p>" });
    expect(cmd.Content.Simple.Body.Text).toBeUndefined();
  });

  it("sendEmail falls back to the verified sender domain when env is unset", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.resetModules();
    emailModule = await import("@/lib/email");

    await expect(
      emailModule.sendEmail({
        to: "user@example.com",
        subject: "Fallback Sender",
        html: "<p>Hello</p>",
      }),
    ).resolves.toBe("ses");

    expect(sendMock).toHaveBeenCalledOnce();
    expect(getLastSentCommand()).toMatchObject({
      FromEmailAddress: "noreply@foreverbrowsing.com",
    });
  });

  it("sendMagicLinkEmail includes code and link", async () => {
    await emailModule.sendMagicLinkEmail(
      "user@example.com",
      "123456",
      "https://app.example.com/verify?token=abc",
    );

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = getLastSentCommand() as {
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

  it("writes a local preview instead of failing in non-production when SES send errors", async () => {
    sendMock.mockRejectedValueOnce(new Error("session expired"));

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
    sendMock.mockRejectedValueOnce(new Error("ses unavailable"));

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
    sendMock.mockRejectedValueOnce(new Error("production send failed"));
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

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = getLastSentCommand() as {
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
    sendMock.mockRejectedValueOnce(new Error("invite delivery failed"));

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

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = getLastSentCommand() as {
      Content: { Simple: { Body: { Html: { Data: string } } } };
    };
    expect(cmd.Content.Simple.Body.Html.Data).toContain(
      "https://app.example.com/issue/ENG-123",
    );
  });
});
