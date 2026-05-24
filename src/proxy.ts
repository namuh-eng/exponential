import {
  CANONICAL_TEAM_KEY,
  CANONICAL_WORKSPACE_SLUG,
} from "@/lib/canonical-routes";
import {
  getPathSegments,
  isAppRoutePrefix,
  isPublicRoutePrefix,
} from "@/lib/workspace-paths";
import { type NextRequest, NextResponse } from "next/server";

export const PUBLIC_ROUTES = [
  "/homepage",
  "/pricing",
  "/customers",
  "/changelog",
  "/now",
] as const;

const publicPaths = [
  "/login",
  "/signup",
  ...PUBLIC_ROUTES,
  "/api/auth",
  "/api/workspaces",
  "/api/test",
  "/api/account",
];

function isPublicPath(pathname: string): boolean {
  return publicPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isStaticPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  );
}

function getCanonicalSettingsPath(pathname: string) {
  const segments = getPathSegments(pathname);
  const settingsStart =
    segments[0] === "settings"
      ? 0
      : !isAppRoutePrefix(segments[0]) &&
          !isPublicRoutePrefix(segments[0]) &&
          segments[1] === "settings"
        ? 1
        : null;

  if (
    settingsStart !== null &&
    segments[settingsStart + 1] === "account" &&
    segments[settingsStart + 2] === "connected"
  ) {
    const canonicalSegments = [...segments];
    canonicalSegments[settingsStart + 2] = "connections";
    return `/${canonicalSegments.join("/")}`;
  }

  return null;
}

function isWorkspaceSlugSegment(segment: string | undefined) {
  return segment && !isAppRoutePrefix(segment) && !isPublicRoutePrefix(segment);
}

function isWorkspaceScopedAppPath(pathname: string) {
  const segments = getPathSegments(pathname);
  return (
    isWorkspaceSlugSegment(segments[0]) &&
    (segments.length === 1 ||
      (segments.length > 1 && isAppRoutePrefix(segments[1])))
  );
}

function getSlugRewrite(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    segments.length > 1 &&
    isWorkspaceSlugSegment(segments[0]) &&
    isAppRoutePrefix(segments[1])
  ) {
    return {
      slug: decodeURIComponent(segments[0]),
      pathname: `/${segments.slice(1).join("/")}`,
    };
  }

  return null;
}

function getWorkspacePrefixedSettingsRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    segments.length > 2 &&
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "settings"
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedProjectsRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "projects" &&
    (segments.length === 2 || (segments.length === 3 && segments[2] === "all"))
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedProjectRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "project" &&
    segments.length >= 3
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedCyclesRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "cycles" &&
    segments.length === 2
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedTeamCyclesRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "team" &&
    segments[3] === "cycles" &&
    (segments.length === 4 || segments.length === 5)
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedTeamProjectsRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    segments.length === 4 &&
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "team" &&
    segments[3] === "projects"
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedTeamViewsRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "team" &&
    segments[3] === "views" &&
    (segments.length === 4 ||
      (segments.length === 5 &&
        (segments[4] === "issues" || segments[4] === "projects")))
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspacePrefixedTeamAnalyticsRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "team" &&
    segments.length >= 4 &&
    (segments[3] === "analytics" || segments[3] === "insights")
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getWorkspaceCyclesRedirect(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "cycles" &&
    segments.length === 2
  ) {
    return `/${segments[0]}/team/${CANONICAL_TEAM_KEY}/cycles`;
  }

  return null;
}

function getWorkspacePrefixedInitiativesRoute(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    isWorkspaceSlugSegment(segments[0]) &&
    segments[1] === "initiatives" &&
    (segments.length === 2 || segments.length === 3)
  ) {
    return { slug: decodeURIComponent(segments[0]) };
  }

  return null;
}

function getCanonicalTeamRedirect(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    segments[0] === "team" &&
    segments[1] === CANONICAL_TEAM_KEY &&
    segments.length > 2
  ) {
    return `/${CANONICAL_WORKSPACE_SLUG}/${segments.join("/")}`;
  }

  return null;
}

function getCanonicalIssueRedirect(pathname: string) {
  const segments = getPathSegments(pathname);

  if (
    segments[0] === "issue" &&
    /^ENG-\d+$/.test(segments[1] ?? "") &&
    segments.length === 2
  ) {
    return `/${CANONICAL_WORKSPACE_SLUG}/${segments.join("/")}`;
  }

  return null;
}

function getWorkspaceRootRedirect(pathname: string) {
  const segments = getPathSegments(pathname);

  if (segments.length === 1 && isWorkspaceSlugSegment(segments[0])) {
    return `/${segments[0]}/inbox`;
  }

  return null;
}

function getWorkspacePrefixedSearchRedirect(
  pathname: string,
  workspaceSlug?: string,
) {
  const segments = getPathSegments(pathname);

  if (segments.length === 1 && segments[0] === "search") {
    return `/${encodeURIComponent(workspaceSlug || CANONICAL_WORKSPACE_SLUG)}/search`;
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const canonicalSettingsPath = getCanonicalSettingsPath(pathname);
  if (canonicalSettingsPath) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.pathname = canonicalSettingsPath;
    return NextResponse.redirect(canonicalUrl);
  }

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (isStaticPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie (Better Auth uses "better-auth.session_token")
  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  if (!sessionToken) {
    const callbackUrl = `${pathname}${search}`;

    if (isWorkspaceScopedAppPath(pathname)) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = "/login";
      rewriteUrl.searchParams.set("callbackUrl", callbackUrl);
      return NextResponse.rewrite(rewriteUrl);
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const workspaceRootRedirect = getWorkspaceRootRedirect(pathname);
  if (workspaceRootRedirect) {
    const workspaceRootUrl = request.nextUrl.clone();
    workspaceRootUrl.pathname = workspaceRootRedirect;
    return NextResponse.redirect(workspaceRootUrl);
  }

  const canonicalTeamRedirect = getCanonicalTeamRedirect(pathname);
  if (canonicalTeamRedirect) {
    const canonicalTeamUrl = request.nextUrl.clone();
    canonicalTeamUrl.pathname = canonicalTeamRedirect;
    return NextResponse.redirect(canonicalTeamUrl);
  }

  const canonicalIssueRedirect = getCanonicalIssueRedirect(pathname);
  if (canonicalIssueRedirect) {
    const canonicalIssueUrl = request.nextUrl.clone();
    canonicalIssueUrl.pathname = canonicalIssueRedirect;
    return NextResponse.redirect(canonicalIssueUrl);
  }

  const workspaceCyclesRedirect = getWorkspaceCyclesRedirect(pathname);
  if (workspaceCyclesRedirect) {
    const workspaceCyclesUrl = request.nextUrl.clone();
    workspaceCyclesUrl.pathname = workspaceCyclesRedirect;
    return NextResponse.redirect(workspaceCyclesUrl);
  }

  const workspacePrefixedSearchRedirect = getWorkspacePrefixedSearchRedirect(
    pathname,
    request.cookies.get("activeWorkspaceSlug")?.value,
  );
  if (workspacePrefixedSearchRedirect) {
    const workspacePrefixedSearchUrl = request.nextUrl.clone();
    workspacePrefixedSearchUrl.pathname = workspacePrefixedSearchRedirect;
    return NextResponse.redirect(workspacePrefixedSearchUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-workspace-source-path", pathname);

  const workspacePrefixedSettingsRoute =
    getWorkspacePrefixedSettingsRoute(pathname);
  if (workspacePrefixedSettingsRoute) {
    requestHeaders.set("x-workspace-slug", workspacePrefixedSettingsRoute.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedProjectsRoute =
    getWorkspacePrefixedProjectsRoute(pathname);
  if (workspacePrefixedProjectsRoute) {
    requestHeaders.set("x-workspace-slug", workspacePrefixedProjectsRoute.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedProjectRoute =
    getWorkspacePrefixedProjectRoute(pathname);
  if (workspacePrefixedProjectRoute) {
    requestHeaders.set("x-workspace-slug", workspacePrefixedProjectRoute.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedCyclesRoute =
    getWorkspacePrefixedCyclesRoute(pathname);
  if (workspacePrefixedCyclesRoute) {
    requestHeaders.set("x-workspace-slug", workspacePrefixedCyclesRoute.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedTeamCyclesRoute =
    getWorkspacePrefixedTeamCyclesRoute(pathname);
  if (workspacePrefixedTeamCyclesRoute) {
    requestHeaders.set(
      "x-workspace-slug",
      workspacePrefixedTeamCyclesRoute.slug,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedTeamProjectsRoute =
    getWorkspacePrefixedTeamProjectsRoute(pathname);
  if (workspacePrefixedTeamProjectsRoute) {
    requestHeaders.set(
      "x-workspace-slug",
      workspacePrefixedTeamProjectsRoute.slug,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedTeamViewsRoute =
    getWorkspacePrefixedTeamViewsRoute(pathname);
  if (workspacePrefixedTeamViewsRoute) {
    requestHeaders.set(
      "x-workspace-slug",
      workspacePrefixedTeamViewsRoute.slug,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedTeamAnalyticsRoute =
    getWorkspacePrefixedTeamAnalyticsRoute(pathname);
  if (workspacePrefixedTeamAnalyticsRoute) {
    requestHeaders.set(
      "x-workspace-slug",
      workspacePrefixedTeamAnalyticsRoute.slug,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const workspacePrefixedInitiativesRoute =
    getWorkspacePrefixedInitiativesRoute(pathname);
  if (workspacePrefixedInitiativesRoute) {
    requestHeaders.set(
      "x-workspace-slug",
      workspacePrefixedInitiativesRoute.slug,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const slugRewrite = getSlugRewrite(pathname);
  if (slugRewrite) {
    requestHeaders.set("x-workspace-slug", slugRewrite.slug);
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = slugRewrite.pathname;
    return NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (browser icon)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
