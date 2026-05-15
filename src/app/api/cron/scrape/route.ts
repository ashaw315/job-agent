import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/pipeline/scrape";

/**
 * GET /api/cron/scrape
 *
 * Daily scrape endpoint, called by GitHub Actions at 8am ET.
 * Bearer-gated for production safety. For manual UI-triggered scrapes,
 * use POST /api/scrape (no auth gate).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScrapePipeline();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
