import {
  createHeadlessAuthProvidersClient,
  headlessAuthProvidersEnabled,
} from "@/lib/headless-api";
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

  if (headlessAuthProvidersEnabled()) {
    const client = createHeadlessAuthProvidersClient();
    const { data, error, response } = await client.POST(
      "/auth/saml/discovery",
      {
        body: { email },
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const result = await discoverSamlUrlFromEmail(email);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ url: result.url });
}
