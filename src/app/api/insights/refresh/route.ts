import { NextResponse } from "next/server";
import { analyzeScoreGaps } from "@/lib/insights/analyze";

/**
 * POST /api/insights/refresh
 *
 * Recomputes the stretch-range gap analysis using Claude and stores the result
 * in settings.key='insights'. The InsightsTab's "Refresh insights" button is the
 * only caller. Hidden behind a two-click reveal in the UI since each call costs
 * Claude API tokens.
 */
export async function POST(): Promise<NextResponse> {
  const result = await analyzeScoreGaps();
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, ...result.data });
}
