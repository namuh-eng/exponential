import {
  getZapierContext,
  unsubscribeZapierHook,
  zapierErrorResponse,
} from "@/lib/zapier";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { context, response } = await getZapierContext(
    request,
    "webhooks:write",
  );
  if (response || !context) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  try {
    const result = await unsubscribeZapierHook(context, body ?? {});
    return NextResponse.json(result);
  } catch (error) {
    return zapierErrorResponse(error);
  }
}
