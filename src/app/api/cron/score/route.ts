import { NextResponse } from "next/server";
import { runScoringPass } from "@/lib/pipeline/scrape";

const PER_CALL_LIMIT = 5;

/**
 * GET /api/cron/score
 *
 * Daily AI-scoring endpoint, called by GitHub Actions immediately after
 * /api/cron/scrape. Bearer-gated for production safety.
 *
 * Scores up to 5 unscored jobs to fit under Vercel Hobby's 60s function limit
 * (Claude calls take 3–8s each; 5 × 8s + sleeps ≈ 45s with headroom). The
 * workflow calls this endpoint twice per day to process up to 10 jobs total;
 * larger backlogs catch up over consecutive days.
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
