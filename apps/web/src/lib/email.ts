import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type SendEmailResult = "sent" | "preview" | "disabled";
export type EmailProviderName = "ses" | "opensend";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailConfig {
  allowPreviewFallback?: boolean;
}

interface EmailProvider {
  name: EmailProviderName;
  from: string;
  send(options: EmailOptions): Promise<void>;
}

function envOrUndefined(key: string): string | undefined {
  const raw = process.env[key];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

function resolveProviderChoice(): EmailProviderName | null {
  const explicit = envOrUndefined("EMAIL_PROVIDER")?.toLowerCase();
  if (explicit === "ses" || explicit === "opensend") return explicit;

  if (envOrUndefined("OPENSEND_API_KEY")) return "opensend";
  if (envOrUndefined("SENDER_EMAIL")) return "ses";
  return null;
}

function getEmailPreviewPath(): string {
  return (
    envOrUndefined("EMAIL_PREVIEW_PATH") ??
    path.join(process.cwd(), ".omx", "email-previews", "latest.json")
  );
}

function buildSesProvider(): EmailProvider | null {
  const from = envOrUndefined("SENDER_EMAIL");
  if (!from) return null;
  const region = envOrUndefined("AWS_REGION") ?? "us-east-1";
  const client = new SESv2Client({ region });

  return {
    name: "ses",
    from,
    async send(options) {
      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [options.to] },
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
      await client.send(command);
    },
  };
}

async function buildOpensendProvider(): Promise<EmailProvider | null> {
  const apiKey = envOrUndefined("OPENSEND_API_KEY");
  const from = envOrUndefined("SENDER_EMAIL");
  if (!apiKey || !from) return null;

  const baseUrl = envOrUndefined("OPENSEND_BASE_URL");
  // `opensend` is an optional peer; load it via a non-literal specifier so
  // TypeScript doesn't try to resolve it at compile time and bundlers don't
  // pull it in for self-hosters who picked SES.
  const moduleId = "opensend";
  const mod = (await import(/* @vite-ignore */ moduleId)) as {
    Opensend: new (
      apiKey: string,
      options?: { baseUrl?: string },
    ) => {
      emails: {
        send(payload: {
          from: string;
          to: string | string[];
          subject: string;
          html?: string;
          text?: string;
        }): Promise<{
          data: unknown;
          error: { message: string; statusCode: number } | null;
        }>;
      };
    };
  };
  const client = new mod.Opensend(apiKey, baseUrl ? { baseUrl } : {});

  return {
    name: "opensend",
    from,
    async send(options) {
      const result = await client.emails.send({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        ...(options.text ? { text: options.text } : {}),
      });
      if (result.error) {
        throw new Error(
          `opensend send failed (${result.error.statusCode}): ${result.error.message}`,
        );
      }
    },
  };
}

async function resolveProvider(): Promise<EmailProvider | null> {
  const choice = resolveProviderChoice();
  if (choice === "opensend") return buildOpensendProvider();
  if (choice === "ses") return buildSesProvider();
  return null;
}

/**
 * True when an email provider is configured. Callers should branch on this
 * before invoking any email-dependent flow (magic links, invitations, etc.).
 */
export function isEmailEnabled(): boolean {
  return resolveProviderChoice() !== null;
}

async function writeEmailPreview(
  provider: EmailProvider,
  options: EmailOptions,
  error: unknown,
): Promise<void> {
  const previewPath = getEmailPreviewPath();
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(
    previewPath,
    JSON.stringify(
      {
        provider: `${provider.name}-preview`,
        from: provider.from,
        ...options,
        createdAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
}

/**
 * Send an email via the configured provider (SES or Opensend).
 *
 * Returns:
 * - "sent"     — delivered successfully
 * - "preview"  — non-production fallback wrote a local JSON file
 * - "disabled" — no provider is configured; caller should skip the flow
 */
export async function sendEmail(
  options: EmailOptions,
  config: SendEmailConfig = {},
): Promise<SendEmailResult> {
  const { allowPreviewFallback = true } = config;
  const provider = await resolveProvider();
  if (!provider) return "disabled";

  try {
    await provider.send(options);
    return "sent";
  } catch (error) {
    if (process.env.NODE_ENV === "production" || !allowPreviewFallback) {
      throw error;
    }
    await writeEmailPreview(provider, options, error);
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
): Promise<SendEmailResult> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 24px;">Sign in to exponential</h2>
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
        Sign in to exponential
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        If you didn't request this email, you can safely ignore it.
      </p>
    </div>
  `;

  const text = `Your sign-in code is: ${code}\n\nOr use this link: ${magicLinkUrl}\n\nThis code expires in 10 minutes.`;

  return sendEmail(
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
): Promise<SendEmailResult> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 24px;">You've been invited to ${workspaceName}</h2>
      <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">
        ${inviterName} has invited you to join <strong>${workspaceName}</strong> on exponential.
      </p>
      <a href="${inviteUrl}" style="display: inline-block; background: #7180ff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
        Accept invitation
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        If you didn't expect this invitation, you can safely ignore it.
      </p>
    </div>
  `;

  const text = `${inviterName} has invited you to join ${workspaceName} on exponential.\n\nAccept: ${inviteUrl}`;

  return sendEmail(
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
): Promise<SendEmailResult> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <p style="color: #d1d5db; font-size: 14px; margin-bottom: 24px;">${body}</p>
      <a href="${actionUrl}" style="display: inline-block; background: #7180ff; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
        View in exponential
      </a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        You received this because of your notification settings.
      </p>
    </div>
  `;

  return sendEmail({ to, subject, html, text: body });
}
