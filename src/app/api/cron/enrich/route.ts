import { NextResponse } from "next/server";
import { runEnrichPass } from "@/lib/pipeline/enrich";

const PER_CALL_LIMIT = 10;

/**
 * GET /api/cron/enrich
 *
 * Daily enrichment endpoint, called by GitHub Actions between /api/cron/scrape
 * and /api/cron/score. Bearer-gated for production safety.
 *
 * Enriches up to 10 aggregator jobs per call. See the lib for details on the
 * candidate query (sources matching AGGREGATOR_SOURCES, description < 200 chars).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runEnrichPass(PER_CALL_LIMIT);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron enrich fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
