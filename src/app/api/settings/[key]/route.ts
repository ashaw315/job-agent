import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const ALLOWED_KEYS = new Set(["profile", "hard_filters", "notifications"]);

/**
 * PUT /api/settings/:key
 * Upsert one setting. Body: { value: string }.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: `Unknown key: ${key}` }, { status: 400 });
    }

    const body = await request.json();
    const value = body?.value;
    if (typeof value !== "string") {
      return NextResponse.json({ error: "value (string) required" }, { status: 400 });
    }

    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });

    return NextResponse.json({ key, value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
