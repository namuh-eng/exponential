import {
  ZAPIER_ACTION_KEYS,
  type ZapierActionKey,
  getZapierContext,
  runZapierAction,
  zapierErrorResponse,
} from "@/lib/zapier";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!ZAPIER_ACTION_KEYS.includes(action as ZapierActionKey)) {
    return NextResponse.json(
      {
        error: {
          code: "unknown_action",
          message: "Zapier action is not supported.",
          field: "action",
        },
      },
      { status: 404 },
    );
  }

  const { context, response } = await getZapierContext(request);
  if (response || !context) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  try {
    const result = await runZapierAction(
      action as ZapierActionKey,
      context,
      body ?? {},
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return zapierErrorResponse(error);
  }
}
