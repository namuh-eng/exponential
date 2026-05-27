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
    <div className="flex min-h-screen items-center justify-center bg-[#090909] px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-[#26262a] bg-[#111113] p-8 text-center">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white">
          {title}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[#9095a1]">
          {description}
        </p>
      </div>
    </div>
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
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <form
        action="/accept-invite/complete"
        method="post"
        className="flex w-full max-w-sm flex-col gap-4 border border-border bg-card p-6"
      >
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <h1 className="font-semibold text-xl">Join workspace</h1>
          <p className="text-muted-foreground text-sm">
            Continue with {session.user.email}.
          </p>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm"
        >
          Accept invitation
        </button>
      </form>
    </div>
  );
}
