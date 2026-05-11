import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const region = process.env.AWS_REGION ?? "us-east-1";
const senderEmail = process.env.SENDER_EMAIL ?? "noreply@foreverbrowsing.com";
const emailPreviewPath =
  process.env.EMAIL_PREVIEW_PATH ??
  path.join(process.cwd(), ".omx", "email-previews", "latest.json");

export const ses = new SESv2Client({ region });

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailConfig {
  allowPreviewFallback?: boolean;
}

async function writeEmailPreview(
  options: EmailOptions,
  error: unknown,
): Promise<void> {
  await mkdir(path.dirname(emailPreviewPath), { recursive: true });
  await writeFile(
    emailPreviewPath,
    JSON.stringify(
      {
        provider: "ses-preview",
        from: senderEmail,
        ...options,
        region,
        createdAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
}

/**
 * Send an email via SES.
 */
export async function sendEmail(
  options: EmailOptions,
  config: SendEmailConfig = {},
): Promise<"ses" | "preview"> {
  const { allowPreviewFallback = true } = config;
  const command = new SendEmailCommand({
    FromEmailAddress: senderEmail,
    Destination: {
      ToAddresses: [options.to],
    },
    Content: {
      Simple: {
        Subject: { Data: options.subject },
        Body: {
          Html: { Data: options.html },
          ...(options.text ? { Text: { Data: options.text } } : {}),
        },
      },
    },
  });

  try {
    await ses.send(command);
    return "ses";
  } catch (error) {
    if (process.env.NODE_ENV === "production" || !allowPreviewFallback) {
      throw error;
    }

    await writeEmailPreview(options, error);
    return "preview";
  }
}

/**
 * Send a magic link authentication email with a 6-digit code.
 */
export async function sendMagicLinkEmail(
  to: string,
  code: string,
  magicLinkUrl: string,
): Promise<void> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 24px;">Sign in to whetline</h2>
      <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">
        Use the code below to sign in. This code expires in 10 minutes.
      </p>
      <div style="background: #1a1a2e; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #7180ff;">${code}</span>
      </div>
      <p style="color: #9ca3af; font-size: 14px; margin-bottom: 16px;">
        Or click the link below:
      </p>
      <a href="${magicLinkUrl}" style="display: inline-block; background: #7180ff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
        Sign in to whetline
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        If you didn't request this email, you can safely ignore it.
      </p>
    </div>
  `;

  const text = `Your sign-in code is: ${code}\n\nOr use this link: ${magicLinkUrl}\n\nThis code expires in 10 minutes.`;

  await sendEmail(
    {
      to,
      subject: `Your sign-in code: ${code}`,
      html,
      text,
    },
    { allowPreviewFallback: true },
  );
}

/**
 * Send a workspace invitation email.
 */
export async function sendInvitationEmail(
  to: string,
  workspaceName: string,
  inviterName: string,
  inviteUrl: string,
): Promise<void> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 24px;">You've been invited to ${workspaceName}</h2>
      <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">
        ${inviterName} has invited you to join <strong>${workspaceName}</strong> on whetline.
      </p>
      <a href="${inviteUrl}" style="display: inline-block; background: #7180ff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
        Accept invitation
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        If you didn't expect this invitation, you can safely ignore it.
      </p>
    </div>
  `;

  const text = `${inviterName} has invited you to join ${workspaceName} on whetline.\n\nAccept: ${inviteUrl}`;

  await sendEmail(
    {
      to,
      subject: `${inviterName} invited you to ${workspaceName}`,
      html,
      text,
    },
    { allowPreviewFallback: false },
  );
}

/**
 * Send a notification email (issue assigned, mentioned, etc.).
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  actionUrl: string,
): Promise<void> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <p style="color: #d1d5db; font-size: 14px; margin-bottom: 24px;">${body}</p>
      <a href="${actionUrl}" style="display: inline-block; background: #7180ff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
        View in whetline
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        You received this because of your notification settings.
      </p>
    </div>
  `;

  await sendEmail({ to, subject, html, text: body });
}
