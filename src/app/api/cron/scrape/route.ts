import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs, watchedCompanies, scrapeLog } from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { scrapeAll } from "@/lib/scrapers";
import { scoreKeywords } from "@/lib/scoring/keyword-scorer";
import { scoreWithAI } from "@/lib/scoring/ai-scorer";
import { ScrapedJob, CronRunSummary } from "@/lib/types";
import { SCORE_THRESHOLD_AI, AI_SCORING_MAX_PER_RUN } from "@/lib/constants";

/**
 * GET /api/cron/scrape
 *
 * Daily scrape job. Called by GitHub Actions at 8am ET.
 * Also callable manually from the settings page.
 *
 * Flow:
 * 1. Fetch all active watched companies
 * 2. Scrape each board
 * 3. Deduplicate + keyword-score + insert new jobs
 * 4. AI-score the top unscored candidates
 * 5. Update company statuses (last_scraped, last_error)
 * 6. Log everything
 */
export async function GET(request: Request) {
  // Auth — GitHub Actions sends Bearer token, manual triggers too
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const errors: string[] = [];
  let totalJobsFound = 0;
  let totalNewJobs = 0;
  let aiScoresRun = 0;

  try {
    // ── Step 1: Fetch active companies ──
    const companies = await db
      .select()
      .from(watchedCompanies)
      .where(eq(watchedCompanies.isActive, true));

    if (companies.length === 0) {
      return NextResponse.json({
        message: "No active watched companies. Run /api/seed first.",
      });
    }

    // ── Step 2: Scrape all boards ──
    console.log(`Scraping ${companies.length} companies...`);
    const scrapeResults = await scrapeAll(companies);

    // ── Step 3: Process results ──
    for (const result of scrapeResults) {
      totalJobsFound += result.jobs.length;

      // Update company status: last_scraped and last_error
      await db
        .update(watchedCompanies)
        .set({
          lastScraped: new Date(),
          lastError: result.error,
        })
        .where(eq(watchedCompanies.id, result.companyId));

      if (result.error) {
        errors.push(result.error);
        console.warn(`Scrape error: ${result.error}`);
      }

      // Insert new jobs
      const newCount = await dedupeAndInsert(result.jobs);
      totalNewJobs += newCount;

      // Log the run
      await db.insert(scrapeLog).values({
        source: `${result.ats}:${result.companyName}`,
        jobsFound: result.jobs.length,
        jobsNew: newCount,
        errors: result.error,
      });
    }

    // ── Step 4: AI-score top unscored candidates ──
    if (process.env.ANTHROPIC_API_KEY) {
      aiScoresRun = await runAIScoring();
    }

    // ── Summary ──
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary: CronRunSummary = {
      run_date: new Date().toISOString(),
      total_companies_scraped: companies.length,
      total_jobs_found: totalJobsFound,
      total_new_jobs: totalNewJobs,
      errors,
      ai_scores_run: aiScoresRun,
    };

    console.log(
      `Cron complete in ${elapsed}s: ${totalNewJobs} new / ${totalJobsFound} found, ${aiScoresRun} AI scored`
    );

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Cron fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

async function dedupeAndInsert(scrapedJobs: ScrapedJob[]): Promise<number> {
  let newCount = 0;

  for (const job of scrapedJobs) {
    // Check if already exists
    const existing = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.externalId, job.external_id), eq(jobs.source, job.source)))
      .limit(1);

    if (existing.length > 0) continue;

    // Keyword score
    const score = scoreKeywords(job);

    try {
      await db.insert(jobs).values({
        externalId: job.external_id,
        source: job.source,
        sourceUrl: job.source_url,
        companyName: job.company_name,
        companyDisplayName: job.company_display_name,
        title: job.title,
        description: job.description,
        location: job.location,
        salaryText: job.salary_text,
        salaryMin: score.salary_min,
        salaryMax: score.salary_max,
        remotePolicy: score.remote_policy,
        keywordScore: score.score,
        isActive: !score.auto_archive,
        status: score.auto_archive ? "passed" : "new",
        datePosted: job.date_posted ? new Date(job.date_posted) : null,
      });
      newCount++;
    } catch (err: unknown) {
      // Unique constraint = race condition dupe, skip
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) continue;
      console.error(`Insert error: ${job.title} @ ${job.company_name}:`, msg);
    }
  }

  return newCount;
}

/**
 * AI-score unscored jobs above keyword threshold.
 * Queue approach: scores top N per run by keyword_score.
 */
async function runAIScoring(): Promise<number> {
  const candidates = await db
    .select()
    .from(jobs)
    .where(
      and(
        gte(jobs.keywordScore, SCORE_THRESHOLD_AI),
        isNull(jobs.aiScoredAt), // Queue: only unscored
        eq(jobs.isActive, true)
      )
    )
    .orderBy(desc(jobs.keywordScore))
    .limit(AI_SCORING_MAX_PER_RUN);

  if (candidates.length === 0) return 0;

  let scored = 0;
  for (const job of candidates) {
    const result = await scoreWithAI(job);

    // Always mark as ai_scored_at even if scoring failed, to avoid retrying bad jobs forever
    const updates: Record<string, unknown> = {
      aiScoredAt: new Date(),
    };

    if (result) {
      updates.aiScore = result.score;
      updates.aiReasoning = result.reasoning;
      updates.tier = result.tier;
      updates.roleCategory = result.role_category;
      scored++;
    }

    await db.update(jobs).set(updates).where(eq(jobs.id, job.id));

    // Rate limit: 500ms between API calls
    await new Promise((r) => setTimeout(r, 500));
  }

  return scored;
}
