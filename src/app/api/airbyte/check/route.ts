import { authenticateAirbyteRequest } from "@/lib/airbyte-source";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response, auth } = await authenticateAirbyteRequest(request);
  if (response || !auth) {
    return response;
  }

  return NextResponse.json({
    status: "SUCCEEDED",
    message: `Authenticated Airbyte source for workspace ${auth.workspaceSlug}.`,
  });
}
