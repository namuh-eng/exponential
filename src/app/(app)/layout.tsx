import { chooseActiveWorkspace } from "@/lib/active-workspace";
import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import { auth } from "@/lib/auth";
import { CANONICAL_WORKSPACE_SLUG } from "@/lib/canonical-routes";
import { db } from "@/lib/db";
import { member, team, workspace } from "@/lib/db/schema";
import {
  DATABASE_BOOTSTRAP_MESSAGE,
  DATABASE_BOOTSTRAP_TITLE,
  shouldRenderDatabaseBootstrapError,
} from "@/lib/dev-database-error";
import { isAppRoutePrefix, normalizeAppPath } from "@/lib/workspace-paths";
import { and, desc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "./app-shell";

function DatabaseBootstrapError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1117] px-6 text-[#f4f5f8]">
      <section className="max-w-xl rounded-2xl border border-[#343847] bg-[#171a22] p-8 shadow-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#8a90a2]">
          Dev setup required
        </p>
        <h1 className="text-2xl font-semibold">{DATABASE_BOOTSTRAP_TITLE}</h1>
        <p className="mt-3 text-sm leading-6 text-[#c4c8d4]">
          {DATABASE_BOOTSTRAP_MESSAGE}
        </p>
        <div className="mt-6 rounded-xl bg-[#0d0f15] p-4 font-mono text-sm text-[#d7dae3]">
          <div>make dev-services</div>
          <div>npm run db:push</div>
          <div>PLAYWRIGHT_TEST=true npm run dev -- -p 3015</div>
        </div>
        <p className="mt-5 text-sm text-[#9aa1b3]">
          If you use a custom database, set DATABASE_URL in .env.local and make
          sure Postgres accepts TCP connections before loading protected routes.
        </p>
      </section>
    </main>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;

  try {
    session = await auth.api.getSession({ headers: requestHeaders });
  } catch (error) {
    if (shouldRenderDatabaseBootstrapError(error)) {
      return <DatabaseBootstrapError />;
    }

    throw error;
  }

  if (!session) {
    redirect("/login");
  }
  let shellData:
    | {
        ws: {
          workspaceId: string;
          workspaceName: string;
          workspaceSlug: string;
        };
        teams: { id: string; name: string; key: string }[];
      }
    | undefined;

  try {
    const cookieStore = await cookies();
    const preferredWorkspaceId = cookieStore.get("activeWorkspaceId")?.value;
    const preferredWorkspaceSlug = cookieStore.get(
      "activeWorkspaceSlug",
    )?.value;
    const requestedWorkspaceSlug = requestHeaders.get("x-workspace-slug");
    const sourcePath = requestHeaders.get("x-workspace-source-path");

    const loadMemberships = () =>
      db
        .select({
          workspaceId: member.workspaceId,
          workspaceName: workspace.name,
          workspaceSlug: workspace.urlSlug,
        })
        .from(member)
        .innerJoin(workspace, eq(member.workspaceId, workspace.id))
        .where(eq(member.userId, session.user.id))
        .orderBy(desc(member.createdAt))
        .limit(50);

    let memberships = await loadMemberships();

    if (memberships.length === 0) {
      await autoJoinWorkspaceForApprovedDomain({
        userId: session.user.id,
        email: session.user.email,
      });
      memberships = await loadMemberships();

      if (memberships.length === 0) {
        redirect("/create-workspace");
      }
    }

    if (
      !memberships.some(
        (membership) => membership.workspaceSlug === CANONICAL_WORKSPACE_SLUG,
      )
    ) {
      const [canonicalMembership] = await db
        .select({
          workspaceId: member.workspaceId,
          workspaceName: workspace.name,
          workspaceSlug: workspace.urlSlug,
        })
        .from(member)
        .innerJoin(workspace, eq(member.workspaceId, workspace.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(workspace.urlSlug, CANONICAL_WORKSPACE_SLUG),
          ),
        )
        .limit(1);

      if (canonicalMembership) {
        memberships.push(canonicalMembership);
      }
    }

    const normalizedSourcePath = sourcePath
      ? normalizeAppPath(sourcePath)
      : null;
    let ws = chooseActiveWorkspace(memberships, {
      requestedWorkspaceSlug,
      preferredWorkspaceSlug,
      preferredWorkspaceId,
      ignoreGeneratedRootRedirectPreference:
        normalizedSourcePath?.startsWith("/my-issues") ?? false,
    });

    if (!ws && requestedWorkspaceSlug) {
      [ws] = await db
        .select({
          workspaceId: member.workspaceId,
          workspaceName: workspace.name,
          workspaceSlug: workspace.urlSlug,
        })
        .from(member)
        .innerJoin(workspace, eq(member.workspaceId, workspace.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(workspace.urlSlug, requestedWorkspaceSlug),
          ),
        )
        .limit(1);
    }

    if (!ws) {
      notFound();
    }

    if (!requestedWorkspaceSlug && normalizedSourcePath) {
      const firstSegment = normalizedSourcePath.split("/").filter(Boolean)[0];

      if (isAppRoutePrefix(firstSegment)) {
        redirect(`/${ws.workspaceSlug}${normalizedSourcePath}`);
      }
    }

    // Get first team
    const teams = await db
      .select({ id: team.id, name: team.name, key: team.key })
      .from(team)
      .where(eq(team.workspaceId, ws.workspaceId))
      .orderBy(desc(team.createdAt))
      .limit(50);

    shellData = { ws, teams };
  } catch (error) {
    if (shouldRenderDatabaseBootstrapError(error)) {
      return <DatabaseBootstrapError />;
    }

    throw error;
  }

  const { ws, teams } = shellData;

  const firstTeam = teams[0] ?? { id: "", name: "Team", key: "TEAM" };

  return (
    <AppShell
      workspaceId={ws.workspaceId}
      workspaceSlug={ws.workspaceSlug}
      workspaceName={ws.workspaceName}
      workspaceInitials={ws.workspaceName.substring(0, 2).toUpperCase()}
      teamName={firstTeam.name}
      teamId={firstTeam.id}
      teamKey={firstTeam.key}
      teams={teams}
    >
      {children}
    </AppShell>
  );
}
