import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

/**
 * POST /api/jobs/reset-scores
 * Nulls all AI-scoring columns so the next scrape rescores everything.
 */
export async function POST() {
  try {
    const result = await db
      .update(jobs)
      .set({
        aiScoredAt: null,
        aiScore: null,
        aiReasoning: null,
        aiGreenFlags: null,
        aiRedFlags: null,
      })
      .returning({ id: jobs.id });

    return NextResponse.json({ count: result.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
