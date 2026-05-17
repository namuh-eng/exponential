import {
  isGitHubOAuthConfigured,
  isGitLabOAuthConfigured,
  isGoogleOAuthConfigured,
  isSlackOAuthConfigured,
} from "@/lib/auth-providers";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
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

export function GET() {
  return NextResponse.json(
    {
      providers: {
        google: accountProviderCapability(isGoogleOAuthConfigured(), "Google"),
        github: accountProviderCapability(isGitHubOAuthConfigured(), "GitHub"),
        gitlab: accountProviderCapability(isGitLabOAuthConfigured(), "GitLab"),
        slack: accountProviderCapability(isSlackOAuthConfigured(), "Slack"),
        passkey: isPasskeyAuthEnabled(),
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
