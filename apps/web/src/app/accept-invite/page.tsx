import {
  PublicPageFrame,
  TerminalHeader,
  TerminalPanel,
} from "@/components/marketing/terminal-primitives";
import { requireApiData } from "@/lib/api-response";
import { createServerApiClient } from "@/lib/server-api-client";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function InviteError({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <PublicPageFrame className="flex items-center justify-center px-4">
      <TerminalPanel
        className="w-full max-w-[420px] text-center"
        header={
          <TerminalHeader
            label="invite/error"
            meta={<span aria-hidden="true">!</span>}
          />
        }
      >
        <div className="p-8">
          <h1 className="text-[22px] font-semibold text-[var(--editorial-ink-1)]">
            {title}
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-[var(--editorial-ink-3)]">
            {description}
          </p>
        </div>
      </TerminalPanel>
    </PublicPageFrame>
  );
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <InviteError
        title="Invitation unavailable"
        description="This invite link is missing required information."
      />
    );
  }

  const client = await createServerApiClient();
  const invitePreview = requireApiData(
    await client.GET("/workspaces/invite-preview", {
      params: { query: { token } },
    }),
    "Preview invite",
  );

  if (!invitePreview.valid) {
    return (
      <InviteError
        title="Invitation expired"
        description="This invite link is invalid or has expired. Ask your teammate to send a new invite."
      />
    );
  }

  const session = await getWebSession(await headers());
  if (!session) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/accept-invite?token=${token}`)}`,
    );
  }

  return (
    <PublicPageFrame className="flex items-center justify-center px-6">
      <form
        action="/accept-invite/complete"
        method="post"
        className="tty-panel flex w-full max-w-sm flex-col gap-4 p-6"
      >
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <p className="text-[11px] uppercase text-[var(--editorial-ink-4)]">
            invite/accept
          </p>
          <h1 className="font-semibold text-[var(--editorial-ink-1)] text-xl">
            Join workspace
          </h1>
          <p className="text-[var(--editorial-ink-3)] text-sm">
            Continue with {session.user.email}.
          </p>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center border border-[var(--editorial-accent)] bg-[var(--editorial-accent)] px-4 font-medium text-[var(--editorial-accent-ink)] text-sm transition-colors hover:bg-[var(--editorial-accent-hover)]"
        >
          Accept invitation
        </button>
      </form>
    </PublicPageFrame>
  );
}
