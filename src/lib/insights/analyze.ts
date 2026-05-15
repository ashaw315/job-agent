import { db } from "@/lib/db";
import { jobs, settings } from "@/lib/db/schema";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { getProfile } from "@/lib/settings/profile";
import { AI_SCORING_MODEL } from "@/lib/constants";

/**
 * Score Insights — analyze the user's "stretch" range jobs (AI score 40–65) to surface
 * what's holding them back. The output is plain markdown describing recurring gaps,
 * classified as reframable vs. real, with concrete next steps.
 *
 * Cached in settings.key='insights' as { lastRefreshedAt, content }. Refresh is
 * manual and costs ~$0.10–$0.30 per call.
 */

export const STRETCH_MIN = 40;
export const STRETCH_MAX = 65;
const MIN_STRETCH_JOBS_FOR_ANALYSIS = 10;
const MAX_STRETCH_JOBS_IN_PROMPT = 15;
const DESCRIPTION_CHAR_BUDGET = 600;
const MAX_TOKENS = 2000;
const REQUEST_TIMEOUT_MS = 60000; // analyzing 15 jobs with a 2000-token response takes longer than a single-job scoring call

export interface InsightsContent {
  lastRefreshedAt: string;
  content: string;
}

export type AnalyzeResult =
  | { ok: true; data: InsightsContent }
  | { ok: false; status: 503 | 500; error: string };

/**
 * Run the full insights pipeline:
 * 1. Count stretch jobs. If <10, return a friendly empty-state message (no API call).
 * 2. Fetch profile and up to 15 stretch jobs.
 * 3. Call Claude with the gap-analysis prompt.
 * 4. Store the result in settings.key='insights' and return it.
 *
 * If ANTHROPIC_API_KEY is unset, returns { ok: false, status: 503 } so the route
 * can surface a helpful message instead of silently failing.
 */
export async function analyzeScoreGaps(): Promise<AnalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, error: "ANTHROPIC_API_KEY not set — insights require Claude API access." };
  }

  // Fetch up to MAX_STRETCH_JOBS_IN_PROMPT + 1 so we can both decide if we have
  // enough AND have the prompt's set ready in one query.
  const stretchJobs = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        gte(jobs.aiScore, STRETCH_MIN),
        lte(jobs.aiScore, STRETCH_MAX),
      )
    )
    .orderBy(desc(jobs.aiScore))
    .limit(MAX_STRETCH_JOBS_IN_PROMPT);

  // Empty state — fewer than 10 stretch jobs. Cache a friendly message so the
  // UI shows it consistently until the next refresh.
  if (stretchJobs.length < MIN_STRETCH_JOBS_FOR_ANALYSIS) {
    const message = `Not enough stretch jobs (need ${MIN_STRETCH_JOBS_FOR_ANALYSIS}+, have ${stretchJobs.length}). Run the scrape a few more times.`;
    const stored = await storeInsights(message);
    return { ok: true, data: stored };
  }

  const profile = await getProfile();
  const prompt = buildPrompt(profile, stretchJobs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_SCORING_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`insights Claude API ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, status: 500, error: `Claude API returned ${res.status}` };
    }

    const data = await res.json();
    const content: string = data?.content?.[0]?.text ?? "";
    if (!content.trim()) {
      return { ok: false, status: 500, error: "Claude returned an empty response." };
    }

    const stored = await storeInsights(content);
    return { ok: true, data: stored };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("insights analyze failed:", msg);
    return { ok: false, status: 500, error: msg };
  }
}

/**
 * Read the cached insights row. Returns null if none exists.
 */
export async function getCachedInsights(): Promise<InsightsContent | null> {
  const row = await db.select().from(settings).where(eq(settings.key, "insights")).limit(1);
  if (!row[0]) return null;
  try {
    const parsed = JSON.parse(row[0].value);
    if (typeof parsed?.content === "string" && typeof parsed?.lastRefreshedAt === "string") {
      return { content: parsed.content, lastRefreshedAt: parsed.lastRefreshedAt };
    }
  } catch {
    // Malformed cache — treat as missing.
  }
  return null;
}

async function storeInsights(content: string): Promise<InsightsContent> {
  const payload: InsightsContent = { lastRefreshedAt: new Date().toISOString(), content };
  await db
    .insert(settings)
    .values({ key: "insights", value: JSON.stringify(payload), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(payload), updatedAt: new Date() },
    });
  return payload;
}

function buildPrompt(
  profile: string,
  stretchJobs: Array<{
    title: string;
    companyName: string;
    companyDisplayName: string | null;
    description: string | null;
  }>
): string {
  const jobBlocks = stretchJobs
    .map(j => {
      const company = j.companyDisplayName ?? j.companyName;
      const excerpt = (j.description ?? "").slice(0, DESCRIPTION_CHAR_BUDGET);
      return `### ${j.title} @ ${company}\n${excerpt}`;
    })
    .join("\n\n");

  return `You are analyzing a set of job listings that scored 40–65 for fit with this candidate. These are "stretch" jobs — close to interviewing range but not over the line. Identify what's holding them back.

## Candidate profile
${profile}

## Stretch jobs (${stretchJobs.length} total)

${jobBlocks}

## Your task
Identify skills, experiences, or qualifications that appear in 3+ of these jobs that the candidate lacks. For each gap:
1. Name the gap (e.g., "5+ years of management experience")
2. Frequency: how many of the ${stretchJobs.length} jobs require it
3. Reframe vs. real gap: can the candidate's existing experience be reframed to address this, or is it a genuine gap requiring new skill development?
4. If reframable: suggest a specific framing the candidate could use in resumes / cover letters
5. If real: suggest a concrete next step (course, project, certification, role)

Respond in plain markdown, sectioned by gap. Be specific, not generic.`;
}
