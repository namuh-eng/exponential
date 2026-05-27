import { chooseActiveWorkspace } from "@/lib/active-workspace";
import { requireApiData } from "@/lib/api-response";
import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import {
  DATABASE_BOOTSTRAP_MESSAGE,
  DATABASE_BOOTSTRAP_SETUP_COMMANDS,
  DATABASE_BOOTSTRAP_TITLE,
  shouldRenderDatabaseBootstrapError,
} from "@/lib/dev-database-error";
import { createServerApiClient } from "@/lib/server-api-client";
import { getWebSession } from "@/lib/web-session";
import { evaluateWorkspaceIpAccess } from "@/lib/workspace-ip-restrictions";
import { isAppRoutePrefix, normalizeAppPath } from "@/lib/workspace-paths";
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
          {DATABASE_BOOTSTRAP_SETUP_COMMANDS.map((command) => (
            <div key={command}>{command}</div>
          ))}
          <div>PLAYWRIGHT_TEST=true npm run dev -- -p 7015</div>
        </div>
        <p className="mt-5 text-sm text-[#9aa1b3]">
          If you use a custom database, set DATABASE_URL in .env.local and make
          sure Postgres accepts TCP connections before loading protected routes.
        </p>
      </section>
    </main>
  );
}

function WorkspaceIpAccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1117] px-6 text-[#f4f5f8]">
      <section className="max-w-xl rounded-2xl border border-[#3f2530] bg-[#1b1117] p-8 shadow-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#ff8ba7]">
          Access denied
        </p>
        <h1 className="text-2xl font-semibold">
          Your network is not allowed for this workspace
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#f0c9d4]">
          This workspace only allows access from configured IP ranges. Switch to
          an approved network or contact a workspace admin to update Security
          settings. Login, logout, invite acceptance, static assets, and test
          setup routes remain outside this workspace gate.
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
  let session: Awaited<ReturnType<typeof getWebSession>>;

  try {
    session = await getWebSession(requestHeaders);
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
        teams: {
          id: string;
          name: string;
          key: string;
          parentTeamId?: string | null;
        }[];
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

    const client = await createServerApiClient();
    const loadMemberships = async () => {
      const result = await client.GET("/workspaces");
      if (result.response.status === 403) {
        return "ip-denied" as const;
      }
      return requireApiData(result, "List workspaces");
    };

    let memberships = await loadMemberships();
    if (memberships === "ip-denied") {
      return <WorkspaceIpAccessDenied />;
    }

    if (memberships.length === 0) {
      await autoJoinWorkspaceForApprovedDomain({
        userId: session.user.id,
        email: session.user.email,
      });
      memberships = await loadMemberships();
      if (memberships === "ip-denied") {
        return <WorkspaceIpAccessDenied />;
      }

      if (memberships.length === 0) {
        redirect("/create-workspace");
      }
    }

    const normalizedSourcePath = sourcePath
      ? normalizeAppPath(sourcePath)
      : null;
    const ws = chooseActiveWorkspace(memberships, {
      requestedWorkspaceSlug,
      preferredWorkspaceSlug,
      preferredWorkspaceId,
      ignoreGeneratedRootRedirectPreference:
        normalizedSourcePath?.startsWith("/my-issues") ?? false,
    });

    if (!ws) {
      notFound();
    }

    const currentWorkspaceResult = await client.GET("/workspaces/current", {
      headers: { "x-workspace-id": ws.workspaceId },
    });
    if (currentWorkspaceResult.response.status === 403) {
      return <WorkspaceIpAccessDenied />;
    }
    const currentWorkspace = requireApiData(
      currentWorkspaceResult,
      "Get current workspace",
    ).workspace;

    const ipAccess = evaluateWorkspaceIpAccess(
      requestHeaders,
      currentWorkspace.settings,
    );
    if (!ipAccess.allowed) {
      return <WorkspaceIpAccessDenied />;
    }

    if (!requestedWorkspaceSlug && normalizedSourcePath) {
      const firstSegment = normalizedSourcePath.split("/").filter(Boolean)[0];

      if (isAppRoutePrefix(firstSegment)) {
        redirect(`/${ws.workspaceSlug}${normalizedSourcePath}`);
      }
    }

    const teams = requireApiData(
      await client.GET("/teams", {
        headers: { "x-workspace-id": ws.workspaceId },
      }),
      "List teams",
    ).teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
      parentTeamId: null,
    }));

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
