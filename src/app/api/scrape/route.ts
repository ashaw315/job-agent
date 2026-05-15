import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/pipeline/scrape";

/**
 * POST /api/scrape
 *
 * UI-triggered scrape. No auth gate — single-user app.
 * For the daily GitHub Actions cron, see /api/cron/scrape (Bearer-gated).
 */
export async function POST() {
  try {
    const summary = await runScrapePipeline();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Scrape fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
