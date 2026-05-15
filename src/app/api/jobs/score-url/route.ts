import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs as jobsTable } from "@/lib/db/schema";
import type { Job } from "@/lib/db/schema";
import { normalizeUrl } from "@/lib/utils";
import { extractJobFromUrl, type ExtractError } from "@/lib/scoring/extract";
import { scoreKeywords } from "@/lib/scoring/keyword-scorer";
import { scoreWithAI } from "@/lib/scoring/ai-scorer";
import { getProfile } from "@/lib/settings/profile";

interface SuccessResponse {
  success: true;
  duplicate: boolean;
  job_id: string;
  title: string;
  company: string;
  keyword_score: number | null;
  ai_score: number | null;
  ai_reasoning: string | null;
  green_flags: string | null;
  red_flags: string | null;
}

interface ErrorResponse {
  success: false;
  error: ExtractError | "invalid_url" | "internal";
}

type ApiResponse = SuccessResponse | ErrorResponse;

/**
 * POST /api/jobs/score-url
 *
 * Body: { url: string }
 *
 * Pipeline: normalize → dedup by source_url → fetch+extract → keyword+AI score → insert.
 * Manual jobs always insert with isActive=true and status="new" — they bypass hard filters
 * and keyword auto-archive. The user explicitly chose to score this URL.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const body = await request.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url : "";
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      return NextResponse.json({ success: false, error: "invalid_url" }, { status: 400 });
    }

    // Dedup by source_url
    const existing = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.sourceUrl, normalized))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json(jobToSuccess(existing[0], true));
    }

    // Extract
    const extracted = await extractJobFromUrl(normalized);
    if (extracted.error || !extracted.job) {
      return NextResponse.json(
        { success: false, error: extracted.error ?? "extraction_failed" },
        { status: 200 }
      );
    }
    const e = extracted.job;

    // Keyword score
    const ks = scoreKeywords({
      external_id: "",       // not used by scoreKeywords
      source: "manual",
      source_url: normalized,
      company_name: e.company_name,
      company_display_name: e.company_display_name,
      title: e.title,
      description: e.description,
      location: e.location,
      salary_text: e.salary_text,
      date_posted: e.date_posted,
    });

    // AI score (always — user-initiated, no keyword-threshold gate)
    const profile = await getProfile();
    const jobForAI = {
      title: e.title,
      companyName: e.company_name,
      companyDisplayName: e.company_display_name,
      location: e.location || null,
      salaryText: e.salary_text,
      description: e.description || null,
    } as Job;  // partial — scoreWithAI only reads these 6 fields
    const ai = await scoreWithAI(jobForAI, profile);

    // Insert (always isActive=true, status='new' — filter bypass)
    const externalId = createHash("sha256").update(normalized).digest("hex").slice(0, 16);

    let inserted: Job;
    try {
      const result = await db
        .insert(jobsTable)
        .values({
          externalId,
          source: "manual",
          sourceUrl: normalized,
          companyName: e.company_name,
          companyDisplayName: e.company_display_name,
          title: e.title,
          description: e.description,
          location: e.location,
          salaryText: e.salary_text,
          salaryMin: ks.salary_min,
          salaryMax: ks.salary_max,
          remotePolicy: ks.remote_policy,
          keywordScore: ks.score,
          isActive: true,
          status: "new",
          datePosted: e.date_posted ? new Date(e.date_posted) : null,
          aiScoredAt: new Date(),
          aiScore: ai?.score ?? null,
          aiReasoning: ai?.reasoning ?? null,
          aiGreenFlags: ai?.green_flags ?? null,
          aiRedFlags: ai?.red_flags ?? null,
          tier: ai?.tier ?? null,
          roleCategory: ai?.role_category ?? null,
        })
        .returning();
      inserted = result[0];
    } catch (err) {
      // Race: another paste of the same URL won the unique constraint. Refetch and return duplicate.
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        const reread = await db
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.sourceUrl, normalized))
          .limit(1);
        if (reread.length > 0) {
          return NextResponse.json(jobToSuccess(reread[0], true));
        }
      }
      throw err;
    }

    return NextResponse.json(jobToSuccess(inserted, false));
  } catch (err) {
    console.error("score-url fatal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "internal" }, { status: 500 });
  }
}

function jobToSuccess(job: Job, duplicate: boolean): SuccessResponse {
  return {
    success: true,
    duplicate,
    job_id: job.id,
    title: job.title,
    company: job.companyDisplayName ?? job.companyName,
    keyword_score: job.keywordScore,
    ai_score: job.aiScore,
    ai_reasoning: job.aiReasoning,
    green_flags: job.aiGreenFlags,
    red_flags: job.aiRedFlags,
  };
}
