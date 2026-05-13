const appRoutePrefixes = [
  "inbox",
  "my-issues",
  "projects",
  "project",
  "views",
  "team",
  "members",
  "teams",
  "issue",
  "initiatives",
  "settings",
  "search",
];

const publicRoutePrefixes = [
  "login",
  "signup",
  "api",
  "onboarding",
  "accept-invite",
  "create-workspace",
  "_next",
  "favicon.ico",
];

export function getPathSegments(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

export function isAppRoutePrefix(segment: string | undefined) {
  return Boolean(segment && appRoutePrefixes.includes(segment));
}

export function isPublicRoutePrefix(segment: string | undefined) {
  return Boolean(segment && publicRoutePrefixes.includes(segment));
}

export function normalizeAppPath(pathname: string) {
  const segments = getPathSegments(pathname);
  if (
    segments.length > 1 &&
    !isAppRoutePrefix(segments[0]) &&
    !isPublicRoutePrefix(segments[0]) &&
    isAppRoutePrefix(segments[1])
  ) {
    return `/${segments.slice(1).join("/")}`;
  }

  return pathname || "/";
}

export function getWorkspaceSlugFromPath(pathname: string) {
  const segments = getPathSegments(pathname);
  if (
    segments.length > 1 &&
    !isAppRoutePrefix(segments[0]) &&
    !isPublicRoutePrefix(segments[0]) &&
    isAppRoutePrefix(segments[1])
  ) {
    return decodeURIComponent(segments[0]);
  }

  return null;
}

export function withWorkspaceSlug(path: string, workspaceSlug?: string | null) {
  if (!workspaceSlug || !path.startsWith("/")) {
    return path;
  }

  const [pathname, suffix = ""] = path.split(/(?=[?#])/, 2);
  const normalizedPathname = normalizeAppPath(pathname);
  const segments = getPathSegments(normalizedPathname);

  if (!isAppRoutePrefix(segments[0])) {
    return path;
  }

  return `/${encodeURIComponent(workspaceSlug)}${normalizedPathname}${suffix}`;
}

export function stripWorkspaceSlug(
  pathname: string,
  workspaceSlug?: string | null,
) {
  const segments = getPathSegments(pathname);
  if (
    workspaceSlug &&
    segments[0] === workspaceSlug &&
    !isAppRoutePrefix(segments[0]) &&
    !isPublicRoutePrefix(segments[0]) &&
    segments.length > 1 &&
    isAppRoutePrefix(segments[1])
  ) {
    return `/${segments.slice(1).join("/")}`;
  }

  return normalizeAppPath(pathname);
}
