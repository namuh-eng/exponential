import { db } from "@/lib/db";
import { verification, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function makeCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const code =
    typeof body.code === "string"
      ? body.code.replace(/\D/g, "").slice(0, 6)
      : "";
  if (!email.includes("@"))
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  const identifier = `signup:${id}:${email}`;
  if (!code) {
    const value = makeCode();
    await db
      .insert(verification)
      .values({
        id: identifier,
        identifier,
        value,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: verification.id,
        set: {
          value,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({
      sent: true,
      devCode: process.env.NODE_ENV === "production" ? undefined : value,
    });
  }
  const rows = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(and(eq(verification.id, identifier), eq(verification.value, code)))
    .limit(1);
  if (rows.length === 0 || rows[0].expiresAt < new Date())
    return NextResponse.json(
      { error: "Invalid or expired verification code" },
      { status: 400 },
    );
  const existingWorkspace = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, id))
    .limit(1);
  const settings = (existingWorkspace[0]?.settings ?? {}) as Record<
    string,
    unknown
  >;
  await db
    .update(workspace)
    .set({
      settings: {
        ...settings,
        signupOwnerEmail: email,
        signupEmailVerified: true,
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, id));
  await db.delete(verification).where(eq(verification.id, identifier));
  return NextResponse.json({ verified: true });
}
