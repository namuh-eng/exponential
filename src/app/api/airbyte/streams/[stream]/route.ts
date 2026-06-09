import {
  authenticateAirbyteRequest,
  buildAirbyteStreamResponse,
  isAirbyteStreamName,
  readAirbyteCursor,
  readAirbyteLimit,
  readAirbyteRecords,
} from "@/lib/airbyte-source";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stream: string }> | { stream: string } },
) {
  const { stream } = await params;
  if (!isAirbyteStreamName(stream)) {
    return NextResponse.json(
      { error: "Unsupported Airbyte stream." },
      { status: 404 },
    );
  }

  const cursorResult = readAirbyteCursor(request);
  if (!cursorResult.ok) {
    return NextResponse.json({ error: cursorResult.error }, { status: 400 });
  }

  const { response, auth } = await authenticateAirbyteRequest(request);
  if (response || !auth) {
    return response;
  }

  const limit = readAirbyteLimit(request);
  const records = await readAirbyteRecords(
    stream,
    auth,
    cursorResult.cursor,
    limit,
  );

  return NextResponse.json(
    buildAirbyteStreamResponse(stream, records, limit, cursorResult.cursor),
  );
}
