import {
  isGitHubOAuthConfigured,
  isGitLabOAuthConfigured,
  isGoogleOAuthConfigured,
  isSlackOAuthConfigured,
} from "@/lib/auth-providers";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      providers: {
        google: isGoogleOAuthConfigured(),
        github: isGitHubOAuthConfigured(),
        gitlab: isGitLabOAuthConfigured(),
        slack: isSlackOAuthConfigured(),
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
