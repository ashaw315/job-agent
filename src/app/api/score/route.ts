import { NextResponse } from "next/server";
import { runScoringPass } from "@/lib/pipeline/scrape";

const PER_CALL_LIMIT = 5;

/**
 * POST /api/score
 *
 * UI- and cron-triggered AI scoring pass. No auth gate — single-user app.
 * Picks up to 5 unscored jobs above the keyword threshold and AI-scores them.
 * Cap is 5 (not the lib default of 30) because Claude API calls take 3–8s each
 * and Vercel Hobby kills functions at 60s. 5 × 8s = 40s, with headroom.
 * Fires the email digest at the end if today matches user preferences.
 *
 * For the daily GitHub Actions cron, see /api/cron/score (Bearer-gated).
 */
export async function POST() {
  try {
    const summary = await runScoringPass(PER_CALL_LIMIT);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Score fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
