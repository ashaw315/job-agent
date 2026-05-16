import { db } from "@/lib/db";
import { jobs, watchedCompanies, scrapeLog } from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { scrapeAll } from "@/lib/scrapers";
import { scoreKeywords } from "@/lib/scoring/keyword-scorer";
import { scoreWithAI } from "@/lib/scoring/ai-scorer";
import { getProfile } from "@/lib/settings/profile";
import { getHardFilters, applyHardFilters, type HardFilters } from "@/lib/settings/hard-filters";
import { maybeRunDigest } from "@/lib/notifications/digest";
import type { ScrapedJob, CronRunSummary } from "@/lib/types";
import { SCORE_THRESHOLD_AI, AI_SCORING_MAX_PER_RUN } from "@/lib/constants";

/**
 * Phase 1: scrape + keyword-score only.
 *
 * Run all watched-company scrapers, dedupe, keyword-score, apply hard filters,
 * insert into jobs. Returns a summary with ai_scores_run=0 since this phase
 * does not call Claude. AI scoring happens in runScoringPass() (separate route).
 *
 * This split exists because Vercel Hobby's 60s function limit can't fit
 * scraping 23+ sources AND running AI scoring on 30 jobs (500ms sleep each = 15s
 * minimum, plus per-call API time). The two phases run sequentially via GitHub Actions.
 *
 * Typical runtime: 30-40s for ~23 sources.
 */
export async function runScrapePipeline(): Promise<CronRunSummary> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalJobsFound = 0;
  let totalNewJobs = 0;

  const [companies, hardFilters] = await Promise.all([
    db.select().from(watchedCompanies).where(eq(watchedCompanies.isActive, true)),
    getHardFilters(),
  ]);

  if (companies.length === 0) {
    return {
      run_date: new Date().toISOString(),
      total_companies_scraped: 0,
      total_jobs_found: 0,
      total_new_jobs: 0,
      errors: ["No active watched companies. Run /api/seed first."],
      ai_scores_run: 0,
    };
  }

  console.log(`Scraping ${companies.length} companies...`);
  const scrapeResults = await scrapeAll(companies);

  for (const result of scrapeResults) {
    totalJobsFound += result.jobs.length;

    await db
      .update(watchedCompanies)
      .set({ lastScraped: new Date(), lastError: result.error })
      .where(eq(watchedCompanies.id, result.companyId));

    if (result.error) {
      errors.push(result.error);
      console.warn(`Scrape error: ${result.error}`);
    }

    const newCount = await dedupeAndInsert(result.jobs, hardFilters);
    totalNewJobs += newCount;

    await db.insert(scrapeLog).values({
      source: `${result.ats}:${result.companyName}`,
      jobsFound: result.jobs.length,
      jobsNew: newCount,
      errors: result.error,
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `Scrape complete in ${elapsed}s: ${totalNewJobs} new / ${totalJobsFound} found`
  );

  return {
    run_date: new Date().toISOString(),
    total_companies_scraped: companies.length,
    total_jobs_found: totalJobsFound,
    total_new_jobs: totalNewJobs,
    errors,
    ai_scores_run: 0,
  };
}

export interface ScoringRunSummary {
  run_date: string;
  ai_scores_run: number;
  candidates_examined: number;
  errors: string[];
}

/**
 * Phase 2: AI scoring only.
 *
 * Picks up unscored jobs above the keyword threshold and AI-scores up to `limit`
 * of them (default {@link AI_SCORING_MAX_PER_RUN} = 30; route handlers should pass
 * a smaller cap to fit under Vercel Hobby's 60s function limit).
 *
 * At ~500ms sleep between API calls plus the call itself (~1-2s), 10 jobs takes
 * roughly 20-30s — comfortably under 60s. The cron-job route uses limit=10.
 *
 * Fires the email digest at the very end so the digest reflects today's AI scores.
 * Digest failures are logged but do not fail the scoring run.
 */
export async function runScoringPass(limit: number = AI_SCORING_MAX_PER_RUN): Promise<ScoringRunSummary> {
  const startTime = Date.now();
  const errors: string[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      run_date: new Date().toISOString(),
      ai_scores_run: 0,
      candidates_examined: 0,
      errors: ["ANTHROPIC_API_KEY not set — skipping AI scoring"],
    };
  }

  const profile = await getProfile();
  const candidates = await db
    .select()
    .from(jobs)
    .where(
      and(
        gte(jobs.keywordScore, SCORE_THRESHOLD_AI),
        isNull(jobs.aiScoredAt),
        eq(jobs.isActive, true)
      )
    )
    .orderBy(desc(jobs.keywordScore))
    .limit(limit);

  let scored = 0;
  for (const job of candidates) {
    const result = await scoreWithAI(job, profile);

    const updates: Record<string, unknown> = { aiScoredAt: new Date() };

    if (result) {
      updates.aiScore = result.score;
      updates.aiReasoning = result.reasoning;
      updates.aiGreenFlags = result.green_flags;
      updates.aiRedFlags = result.red_flags;
      updates.tier = result.tier;
      updates.roleCategory = result.role_category;
      updates.fitConfidence = result.fit_confidence;
      updates.northStarAlignment = result.north_star_alignment;
      updates.gap = result.gap;
      scored++;
    } else {
      errors.push(`scoreWithAI returned null for ${job.title} @ ${job.companyName}`);
    }

    await db.update(jobs).set(updates).where(eq(jobs.id, job.id));
    await new Promise((r) => setTimeout(r, 500));
  }

  // Email digest — fire-and-forget at the end of the scoring pass. Failures are
  // logged but do not fail the run (the user can still see scored jobs in the dashboard).
  try {
    const digestStatus = await maybeRunDigest();
    console.log(digestStatus);
  } catch (err) {
    console.error("Digest send failed:", err instanceof Error ? err.message : err);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `Scoring complete in ${elapsed}s: ${scored}/${candidates.length} candidates AI-scored`
  );

  return {
    run_date: new Date().toISOString(),
    ai_scores_run: scored,
    candidates_examined: candidates.length,
    errors,
  };
}

async function dedupeAndInsert(scrapedJobs: ScrapedJob[], filters: HardFilters): Promise<number> {
  let newCount = 0;

  for (const job of scrapedJobs) {
    const existing = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.externalId, job.external_id), eq(jobs.source, job.source)))
      .limit(1);

    if (existing.length > 0) continue;

    const score = scoreKeywords(job);
    const filterResult = applyHardFilters(job, score, filters);

    // Hard filter failure overrides keyword auto-archive: still archive, but the reason changes.
    const shouldArchive = score.auto_archive || !filterResult.passes;

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
        isActive: !shouldArchive,
        status: shouldArchive ? "passed" : "new",
        datePosted: job.date_posted ? new Date(job.date_posted) : null,
      });
      newCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) continue;
      console.error(`Insert error: ${job.title} @ ${job.company_name}:`, msg);
    }
  }

  return newCount;
}
