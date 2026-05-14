import { isGoogleOAuthConfigured } from "@/lib/auth-providers";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      providers: {
        google: isGoogleOAuthConfigured(),
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
