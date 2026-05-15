import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

/**
 * POST /api/jobs/archive-all
 * Sets status='passed' and is_active=false on every job.
 */
export async function POST() {
  try {
    const result = await db
      .update(jobs)
      .set({ status: "passed", isActive: false })
      .returning({ id: jobs.id });

    return NextResponse.json({ count: result.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
