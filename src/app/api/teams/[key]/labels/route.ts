import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { label } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { eq } from "drizzle-orm";
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

  const labels = await db
    .select({
      id: label.id,
      name: label.name,
      color: label.color,
    })
    .from(label)
    .where(eq(label.teamId, teamRecord.id));

  return NextResponse.json({ labels });
}
