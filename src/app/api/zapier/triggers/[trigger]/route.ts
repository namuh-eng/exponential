import {
  ZAPIER_TRIGGER_KEYS,
  type ZapierTriggerKey,
  getZapierContext,
  pollZapierTrigger,
  zapierErrorResponse,
} from "@/lib/zapier";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trigger: string }> },
) {
  const { trigger } = await params;
  if (!ZAPIER_TRIGGER_KEYS.includes(trigger as ZapierTriggerKey)) {
    return NextResponse.json(
      {
        error: {
          code: "unknown_trigger",
          message: "Zapier trigger is not supported.",
          field: "trigger",
        },
      },
      { status: 404 },
    );
  }

  const { context, response } = await getZapierContext(request);
  if (response || !context) {
    return response;
  }

  try {
    const items = await pollZapierTrigger(
      trigger as ZapierTriggerKey,
      context,
      request,
    );
    return NextResponse.json(items);
  } catch (error) {
    return zapierErrorResponse(error);
  }
}
