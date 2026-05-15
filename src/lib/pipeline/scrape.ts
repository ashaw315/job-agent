import { db } from "@/lib/db";
import { jobs, watchedCompanies, scrapeLog } from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { scrapeAll } from "@/lib/scrapers";
import { scoreKeywords } from "@/lib/scoring/keyword-scorer";
import { scoreWithAI } from "@/lib/scoring/ai-scorer";
import { getProfile } from "@/lib/settings/profile";
import { getHardFilters, applyHardFilters, type HardFilters } from "@/lib/settings/hard-filters";
import type { ScrapedJob, CronRunSummary } from "@/lib/types";
import { SCORE_THRESHOLD_AI, AI_SCORING_MAX_PER_RUN } from "@/lib/constants";

/**
 * Run the full scrape pipeline:
 * 1. Fetch active watched companies
 * 2. Scrape each board
 * 3. Dedupe + keyword-score + hard-filter + insert
 * 4. AI-score top unscored candidates (using DB profile or default)
 * 5. Update company statuses, log everything
 */
export async function runScrapePipeline(): Promise<CronRunSummary> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalJobsFound = 0;
  let totalNewJobs = 0;
  let aiScoresRun = 0;

  const [companies, hardFilters, profile] = await Promise.all([
    db.select().from(watchedCompanies).where(eq(watchedCompanies.isActive, true)),
    getHardFilters(),
    getProfile(),
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

  if (process.env.ANTHROPIC_API_KEY) {
    aiScoresRun = await runAIScoring(profile);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `Pipeline complete in ${elapsed}s: ${totalNewJobs} new / ${totalJobsFound} found, ${aiScoresRun} AI scored`
  );

  return {
    run_date: new Date().toISOString(),
    total_companies_scraped: companies.length,
    total_jobs_found: totalJobsFound,
    total_new_jobs: totalNewJobs,
    errors,
    ai_scores_run: aiScoresRun,
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

async function runAIScoring(profile: string): Promise<number> {
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
    .limit(AI_SCORING_MAX_PER_RUN);

  if (candidates.length === 0) return 0;

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
      scored++;
    }

    await db.update(jobs).set(updates).where(eq(jobs.id, job.id));
    await new Promise((r) => setTimeout(r, 500));
  }

  return scored;
}
