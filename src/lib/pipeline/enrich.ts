import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, or, isNull, lt, sql } from "drizzle-orm";
import { extractJobFromUrl } from "@/lib/scoring/extract";

/**
 * Aggregator scrapers only have listing-page snippets (~150-300 chars) in their
 * job rows. Re-fetching the actual posting URL gets the full description so the
 * AI scorer has the same signal as for company-board jobs.
 *
 * This runs as a separate pipeline phase between scrape and score so each phase
 * stays under Vercel Hobby's 60s function limit.
 */

/** Source slugs from src/lib/scrapers/custom/* — only these sources get enriched. */
export const AGGREGATOR_SOURCES = [
  "builtinnyc",
  "weworkremotely",
  "dribbble",
  "awwwards",
  "mediabistro",
  "whitney",
  "creativeapplications",
] as const;

/** Below this length the description is treated as a snippet that needs enriching. */
const SHORT_DESCRIPTION_THRESHOLD = 200;
/** Rate-limit delay between fetches. Polite to targets and avoids tripping anti-scraping. */
const DELAY_BETWEEN_FETCHES_MS = 2000;

export interface EnrichRunSummary {
  run_date: string;
  candidates_examined: number;
  enriched: number;
  skipped: number;
  errors: string[];
}

/**
 * Enrich up to `limit` aggregator jobs by re-fetching their source_url and
 * replacing the listing snippet with the full extracted description.
 *
 * Per-job failures (unreachable URL, auth-gated, extraction_failed, etc.) are
 * logged and skipped; they do not abort the run. AI scoring is NOT triggered —
 * that's a separate phase.
 */
export async function runEnrichPass(limit: number): Promise<EnrichRunSummary> {
  const startTime = Date.now();
  const errors: string[] = [];
  let enriched = 0;
  let skipped = 0;

  // Candidates: active aggregator jobs with a source_url, where the description
  // is missing or shorter than SHORT_DESCRIPTION_THRESHOLD chars.
  const candidates = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        inArray(jobs.source, AGGREGATOR_SOURCES as unknown as string[]),
        isNotNull(jobs.sourceUrl),
        or(
          isNull(jobs.description),
          lt(sql<number>`length(${jobs.description})`, SHORT_DESCRIPTION_THRESHOLD)
        ),
      )
    )
    .limit(limit);

  if (candidates.length === 0) {
    return {
      run_date: new Date().toISOString(),
      candidates_examined: 0,
      enriched: 0,
      skipped: 0,
      errors: [],
    };
  }

  for (let i = 0; i < candidates.length; i++) {
    const job = candidates[i];
    const url = job.sourceUrl;
    if (!url) {
      skipped++;
      continue;
    }

    try {
      const result = await extractJobFromUrl(url);
      if (result.error || !result.job) {
        // Soft failure (unreachable, auth_gated, not_a_job, extraction_failed) —
        // skip and move on. Don't block the run on per-job problems.
        skipped++;
        errors.push(`${job.source}:${job.id} ${result.error ?? "no_job_returned"}`);
      } else {
        const newDesc = result.job.description;
        if (newDesc && newDesc.length > (job.description?.length ?? 0)) {
          await db
            .update(jobs)
            .set({ description: newDesc })
            .where(eq(jobs.id, job.id));
          enriched++;
        } else {
          // Extraction returned a description that's no better than what we
          // already have. Skip without an error — this is a real outcome.
          skipped++;
        }
      }
    } catch (err) {
      skipped++;
      errors.push(`${job.source}:${job.id} ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    // Sleep between fetches, but not after the last one.
    if (i < candidates.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_FETCHES_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `Enrich complete in ${elapsed}s: ${enriched} enriched / ${skipped} skipped / ${candidates.length} candidates`
  );

  return {
    run_date: new Date().toISOString(),
    candidates_examined: candidates.length,
    enriched,
    skipped,
    errors,
  };
}
