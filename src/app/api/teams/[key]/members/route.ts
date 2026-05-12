import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { teamMember, user } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { eq, sql } from "drizzle-orm";
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

  const members = await db
    .select({
      id: teamMember.id,
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      role: sql<string>`'member'`,
    })
    .from(teamMember)
    .innerJoin(user, eq(teamMember.userId, user.id))
    .where(eq(teamMember.teamId, teamRecord.id));

  return NextResponse.json({ members });
}
