import { requireApiSession } from "@/lib/api-auth";
import { findAccessibleTeam } from "@/lib/teams";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Placeholder for when templates table is added
  return NextResponse.json({
    team: { name: teamRecord.name },
    templates: [],
  });
}
