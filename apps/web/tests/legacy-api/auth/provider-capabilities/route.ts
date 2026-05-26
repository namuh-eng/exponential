import {
  isGitHubOAuthConfigured,
  isGitLabOAuthConfigured,
  isGoogleOAuthConfigured,
  isSlackOAuthConfigured,
} from "@/lib/auth-providers";
import {
  createHeadlessAuthProvidersClient,
  headlessAuthProvidersEnabled,
} from "@/lib/headless-api";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import {
  isWorkspaceAuthMethodAllowed,
  resolveWorkspaceAuthPolicy,
} from "@/lib/workspace-auth-methods";
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
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get("callbackUrl");

  if (headlessAuthProvidersEnabled()) {
    const client = createHeadlessAuthProvidersClient();
    const { data, error, response } = await client.GET(
      "/auth/provider-capabilities",
      {
        params: {
          query: callbackUrl ? { callbackUrl } : {},
        },
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    const cacheControl = (response as Response).headers.get("cache-control");
    return NextResponse.json(data, {
      status: (response as Response).status,
      headers: cacheControl ? { "Cache-Control": cacheControl } : undefined,
    });
  }

  const policy = await resolveWorkspaceAuthPolicy({
    callbackUrl,
    baseUrl: url.origin,
  });
  const googleAllowed = isWorkspaceAuthMethodAllowed(policy, "google");
  const emailPasskeyAllowed = isWorkspaceAuthMethodAllowed(
    policy,
    "emailPasskey",
  );

  return NextResponse.json(
    {
      providers: {
        google: accountProviderCapability(
          googleAllowed && isGoogleOAuthConfigured(),
          "Google",
        ),
        github: accountProviderCapability(isGitHubOAuthConfigured(), "GitHub"),
        gitlab: accountProviderCapability(isGitLabOAuthConfigured(), "GitLab"),
        slack: accountProviderCapability(isSlackOAuthConfigured(), "Slack"),
        passkey: emailPasskeyAllowed && isPasskeyAuthEnabled(),
        googleAllowed,
        emailPasskey: emailPasskeyAllowed,
      },
      workspace: policy
        ? {
            slug: policy.workspaceSlug,
            authentication: policy.authentication,
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
