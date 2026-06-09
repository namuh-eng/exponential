import { refreshDueGoogleSheetsIntegrations } from "@/lib/google-sheets-sync";
import { NextResponse } from "next/server";

function getConfiguredSyncSecret() {
  return process.env.GOOGLE_SHEETS_SYNC_SECRET || process.env.CRON_SECRET;
}

function isAuthorized(request: Request) {
  const secret = getConfiguredSyncSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await refreshDueGoogleSheetsIntegrations();
  return NextResponse.json({ success: true, summary });
}
