import {
  getPathSegments,
  isAppRoutePrefix,
  isPublicRoutePrefix,
} from "@/lib/workspace-paths";
import { type NextRequest, NextResponse } from "next/server";

const publicPaths = [
  "/login",
  "/signup",
  "/api/auth",
  "/api/workspaces",
  "/api/test",
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

function getWorkspaceRootRedirect(pathname: string) {
  const segments = getPathSegments(pathname);

  if (segments.length === 1 && isWorkspaceSlugSegment(segments[0])) {
    return `/${segments[0]}/inbox`;
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

  const workspaceRootRedirect = getWorkspaceRootRedirect(pathname);
  if (workspaceRootRedirect) {
    const workspaceRootUrl = request.nextUrl.clone();
    workspaceRootUrl.pathname = workspaceRootRedirect;
    return NextResponse.redirect(workspaceRootUrl);
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
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-workspace-source-path", pathname);

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
