import {
  AIRBYTE_CATALOG,
  AIRBYTE_PRIVATE_DATA_BEHAVIOR,
  authenticateAirbyteRequest,
} from "@/lib/airbyte-source";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response, auth } = await authenticateAirbyteRequest(request);
  if (response || !auth) {
    return response;
  }

  return NextResponse.json({
    connector: {
      name: "Exponential Airbyte source",
      workspaceId: auth.workspaceId,
      workspaceSlug: auth.workspaceSlug,
      supportedSyncModes: ["full_refresh", "incremental"],
    },
    streams: AIRBYTE_CATALOG,
    privateData: AIRBYTE_PRIVATE_DATA_BEHAVIOR,
  });
}
