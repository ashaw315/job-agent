import { NextResponse } from "next/server";
import { runScoringPass } from "@/lib/pipeline/scrape";

const PER_CALL_LIMIT = 10;

/**
 * GET /api/cron/score
 *
 * Daily AI-scoring endpoint, called by GitHub Actions immediately after
 * /api/cron/scrape. Bearer-gated for production safety.
 *
 * Scores up to 10 unscored jobs to fit under Vercel Hobby's 60s function limit.
 * If more than 10 are eligible per day, multiple cron runs catch up over days —
 * acceptable given that the daily inflow is typically <30 candidate jobs.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScoringPass(PER_CALL_LIMIT);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron score fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
