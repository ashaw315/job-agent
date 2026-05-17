import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { scoreKeywords } from "@/lib/scoring/keyword-scorer";

interface RescoreSummary {
  examined: number;
  updated: number;
  archived_now: number;   // newly archived because keyword rules tightened
  unarchived_now: number; // newly un-archived because keyword rules relaxed
  unchanged: number;
}

/**
 * POST /api/jobs/rescore-keywords
 *
 * Re-runs the keyword scorer on every job in the database and updates
 * keyword_score, is_active, and status to reflect the current rules.
 *
 * Use after changing scoring weights, adding title_negative terms, or shipping
 * keyword-scorer logic changes (e.g., the title_negative hard-archive fix).
 *
 * Scope: ALL jobs, not just active ones. Inactive jobs get re-scored too so
 * positive-signal additions can un-archive a previously-archived row; active
 * jobs get re-scored so newly-added disqualifiers can archive a current row.
 *
 * Does NOT re-run AI scoring — that's a separate phase (POST /api/score).
 * Single-user app, so no auth gate matching the rest of /api/jobs/*.
 */
export async function POST() {
  try {
    const all = await db.select().from(jobs);

    let updated = 0;
    let archived_now = 0;
    let unarchived_now = 0;
    let unchanged = 0;

    for (const job of all) {
      const rescored = scoreKeywords({
        external_id: job.externalId ?? "",
        source: job.source,
        source_url: job.sourceUrl ?? "",
        company_name: job.companyName,
        company_display_name: job.companyDisplayName ?? job.companyName,
        title: job.title,
        description: job.description ?? "",
        location: job.location ?? "",
        salary_text: job.salaryText,
        date_posted: null,
      });

      const newActive = !rescored.auto_archive;
      const newStatus = rescored.auto_archive
        ? "passed"
        : (job.isActive ? job.status : "new");

      const scoreChanged = rescored.score !== job.keywordScore;
      const activeChanged = newActive !== job.isActive;
      const statusChanged = newStatus !== job.status;

      if (!scoreChanged && !activeChanged && !statusChanged) {
        unchanged++;
        continue;
      }

      await db
        .update(jobs)
        .set({
          keywordScore: rescored.score,
          salaryMin: rescored.salary_min ?? job.salaryMin,
          salaryMax: rescored.salary_max ?? job.salaryMax,
          remotePolicy: rescored.remote_policy ?? job.remotePolicy,
          isActive: newActive,
          status: newStatus,
        })
        .where(eq(jobs.id, job.id));

      updated++;
      if (job.isActive && !newActive) archived_now++;
      if (!job.isActive && newActive) unarchived_now++;
    }

    const summary: RescoreSummary = {
      examined: all.length,
      updated,
      archived_now,
      unarchived_now,
      unchanged,
    };
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("rescore-keywords fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
