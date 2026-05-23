import { discoverSamlUrlFromEmail } from "@/lib/saml-sso";
import { NextResponse } from "next/server";

type RequestBody = {
  email?: unknown;
  isDesktop?: unknown;
  type?: unknown;
  callbackURL?: unknown;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const result = await discoverSamlUrlFromEmail(email);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ url: result.url });
}
