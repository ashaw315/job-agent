import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

/**
 * GET /api/settings
 * Returns all settings as { key: value } object.
 * Values are returned as raw strings — callers JSON.parse if needed.
 */
export async function GET() {
  try {
    const rows = await db.select().from(settings);
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
