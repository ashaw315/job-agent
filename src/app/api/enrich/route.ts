import { NextResponse } from "next/server";
import { runEnrichPass } from "@/lib/pipeline/enrich";

const PER_CALL_LIMIT = 10;

/**
 * POST /api/enrich
 *
 * UI- and cron-triggered description enrichment pass. No auth gate — single-user app.
 * Re-fetches aggregator jobs whose description is missing or under 200 chars,
 * replacing the listing snippet with the full extracted description.
 *
 * Cap is 10 jobs per call; with a 2-second rate-limit sleep between each fetch
 * plus per-fetch network time, 10 calls take roughly 25–50 seconds. Stays under
 * Vercel Hobby's 60s function limit.
 *
 * Does NOT trigger AI scoring — that runs in /api/score afterward, which now
 * sees the enriched descriptions on its next pass.
 *
 * For the daily GitHub Actions cron, see /api/cron/enrich (Bearer-gated).
 */
export async function POST() {
  try {
    const summary = await runEnrichPass(PER_CALL_LIMIT);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Enrich fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
