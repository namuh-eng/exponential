import { getZapierManifest } from "@/lib/zapier";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return NextResponse.json(getZapierManifest(request));
}
