import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import {
  sanitizeWorkspaceSlug,
  validateWorkspaceSlug,
} from "@/lib/workspace-creation";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = sanitizeWorkspaceSlug(url.searchParams.get("slug") ?? "");
  const error = validateWorkspaceSlug(slug);
  if (error)
    return NextResponse.json(
      { available: false, slug, error },
      { status: 400 },
    );
  const existing = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.urlSlug, slug))
    .limit(1);
  return NextResponse.json({ available: existing.length === 0, slug });
}
