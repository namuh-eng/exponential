import { getZapierContext } from "@/lib/zapier";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { context, response } = await getZapierContext(request);
  if (response || !context) {
    return response;
  }

  return NextResponse.json({
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    workspaceId: context.workspaceId,
  });
}
