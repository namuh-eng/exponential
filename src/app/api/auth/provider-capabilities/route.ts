import {
  isGitHubOAuthConfigured,
  isGitLabOAuthConfigured,
  isGoogleOAuthConfigured,
  isSlackOAuthConfigured,
} from "@/lib/auth-providers";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import {
  getWorkspaceAuthPolicyBySlug,
  getWorkspaceSlugFromCallbackUrl,
} from "@/lib/workspace-auth-settings";
import { NextResponse } from "next/server";

function accountProviderCapability(configured: boolean, label: string) {
  const devLinking = process.env.NODE_ENV !== "production";

  return {
    supported: true,
    configured,
    devLinking: configured || devLinking,
    unavailableReason: configured
      ? null
      : `${label} OAuth is not configured. Dev and e2e can still exercise the linking surface.`,
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackUrl = requestUrl.searchParams.get("callbackUrl");
  const workspaceSlug =
    requestUrl.searchParams.get("workspaceSlug") ??
    getWorkspaceSlugFromCallbackUrl(callbackUrl, requestUrl.origin);
  const workspacePolicy = await getWorkspaceAuthPolicyBySlug(workspaceSlug);
  const workspaceAuthentication = workspacePolicy?.authentication;
  const googleConfigured = isGoogleOAuthConfigured();
  const passkeyConfigured = isPasskeyAuthEnabled();
  const googleLoginAllowed =
    googleConfigured && workspaceAuthentication?.google !== false;
  const emailPasskeyAllowed = workspaceAuthentication?.emailPasskey !== false;

  return NextResponse.json(
    {
      providers: {
        google: workspacePolicy
          ? googleLoginAllowed
          : accountProviderCapability(googleConfigured, "Google"),
        github: accountProviderCapability(isGitHubOAuthConfigured(), "GitHub"),
        gitlab: accountProviderCapability(isGitLabOAuthConfigured(), "GitLab"),
        slack: accountProviderCapability(isSlackOAuthConfigured(), "Slack"),
        email: emailPasskeyAllowed,
        passkey: passkeyConfigured && emailPasskeyAllowed,
      },
      workspace: workspacePolicy
        ? {
            slug: workspacePolicy.workspaceSlug,
            authentication: workspacePolicy.authentication,
          }
        : null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
