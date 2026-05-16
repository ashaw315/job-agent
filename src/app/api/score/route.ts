import { NextResponse } from "next/server";
import { runScoringPass } from "@/lib/pipeline/scrape";

const PER_CALL_LIMIT = 10;

/**
 * POST /api/score
 *
 * UI- and cron-triggered AI scoring pass. No auth gate — single-user app.
 * Picks up to 10 unscored jobs above the keyword threshold and AI-scores them.
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
