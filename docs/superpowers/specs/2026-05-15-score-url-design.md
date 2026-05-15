# Score Any Job URL Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation plan

## Summary

Add a URL input bar to the top of the dashboard. Paste any job listing URL → page is fetched, job details extracted (JSON-LD first, Claude fallback), scored against the user's profile, and inserted into the jobs table with `source='manual'`. Total round-trip ~15 seconds. Manual jobs **bypass all hard filters and keyword auto-archive** — the user explicitly chose to score this job, so it always appears in the dashboard regardless of score. No new schema changes besides an index on `source_url` for fast dedup.

## Architecture

**One new server module + one new route + one new dashboard component.**

- `src/lib/scoring/extract.ts` — extracts a `ScrapedJob`-shaped object from a URL. Two strategies, JSON-LD then Claude. Returns a structured result with an error type when neither strategy yields enough data.
- `src/lib/utils.ts` — gains `normalizeUrl(input: string): string | null` (also returns `null` for malformed URLs). Used by both the route handler and the dedup check.
- `POST /api/jobs/score-url` — orchestrates the pipeline: normalize URL → dedup lookup → fetch+extract → score (keyword + AI) → insert → return result.
- `src/components/dashboard/UrlBar.tsx` — input + button + staged loading messages + toast on completion. Mounted above `<StatsBar />` in `<Dashboard />`.
- `src/components/dashboard/Dashboard.tsx` — adds the URL bar, plus a way for the bar to push a new job into local `jobs` state without a full re-fetch (so the new row appears immediately).

**Pipeline integration:** the manual route uses the same `scoreKeywords()` and `scoreWithAI()` libraries as the cron pipeline. It does NOT call `runScrapePipeline()` (that's batched/multi-company logic). Instead it reuses just the scoring helpers and writes one row to `jobs` with `source='manual'`.

**No new env vars.** Reuses `ANTHROPIC_API_KEY` (already used by AI scorer) and `DATABASE_URL`.

**Files:**

| Path | Purpose |
|---|---|
| `src/lib/scoring/extract.ts` | `extractJobFromUrl(url): Promise<ExtractResult>`. JSON-LD primary, Claude fallback. |
| `src/lib/utils.ts` | Add `normalizeUrl(input): string \| null`. Strips query params, trailing slash, lowercases host. |
| `src/app/api/jobs/score-url/route.ts` | `POST` handler. Orchestrates the pipeline. |
| `src/lib/db/schema.ts` | Add `idx_jobs_source_url` index on `jobs.sourceUrl`. |
| `src/components/dashboard/UrlBar.tsx` | URL input, score button, staged loading state, toast on completion. |
| `src/components/dashboard/Dashboard.tsx` | Mount `<UrlBar />`, accept new jobs from it into local state. |
| `vercel.json` | Add `maxDuration: 60` for the new route. |

## Schema Changes

One new index, no new columns:

```ts
// In src/lib/db/schema.ts, inside the jobs table's index block:
index("idx_jobs_source_url").on(table.sourceUrl),
```

`source_url` already exists and is `text` nullable. The new index makes dedup-by-URL fast (the dedup query runs on every paste; without an index it'd seq-scan 1300+ rows).

`npm run db:push` after adding the index. No data migration.

## URL Normalization

`normalizeUrl(input: string): string | null`

- Trim whitespace.
- Validate via `new URL(input)`; return `null` if it throws.
- Lowercase the host (URLs are case-insensitive on host, case-sensitive on path).
- Strip the query string entirely (drops `?utm_source=...`, `?gh_jid=...`, etc.).
- Strip the fragment (`#hash`).
- Strip a single trailing slash from the path (but keep a bare `/` if that's the whole path — though no job URL has just `/`).
- Return the result.

Examples:
- `  https://Boards.Greenhouse.io/linear/jobs/123?utm=x/  ` → `https://boards.greenhouse.io/linear/jobs/123`
- `https://jobs.lever.co/doji/abc-123/` → `https://jobs.lever.co/doji/abc-123`
- `not-a-url` → `null`

Dedup uses the normalized form. The stored `source_url` is the normalized form.

## API Route

`POST /api/jobs/score-url`

**Request body:**
```json
{ "url": "https://boards.greenhouse.io/example/jobs/123" }
```

**Response (success):**
```json
{
  "success": true,
  "job_id": "uuid",
  "title": "Senior Frontend Engineer",
  "company": "Example Co",
  "keyword_score": 65,
  "ai_score": 78,
  "ai_reasoning": "...",
  "green_flags": "...",
  "red_flags": "...",
  "duplicate": false
}
```

**Response (duplicate):**
```json
{
  "success": true,
  "job_id": "uuid-of-existing-row",
  "title": "...",
  "company": "...",
  "keyword_score": 65,
  "ai_score": 78,
  "ai_reasoning": "...",
  "green_flags": "...",
  "red_flags": "...",
  "duplicate": true
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "unreachable" | "auth_gated" | "not_a_job" | "extraction_failed" | "invalid_url" | "internal"
}
```

Error codes are short enums; the UI maps them to user-facing strings.

**No auth gate.** Single-user app; matches the existing open routes (`/api/scrape`, `/api/jobs PATCH`, `/api/jobs/reset-scores`, `/api/jobs/archive-all`, `/api/jobs/export`, `/api/settings`). Bearer-gating remains only on `/api/cron/scrape` for the GitHub Actions cron.

## Orchestration (the actual flow)

```ts
// pseudocode for the POST handler
1. parse body, validate url present
2. const normalized = normalizeUrl(body.url)
   if (!normalized) return { success: false, error: "invalid_url" }
3. // Dedup
   const existing = await db.select().from(jobs).where(eq(jobs.sourceUrl, normalized)).limit(1)
   if (existing.length > 0) {
     return { success: true, duplicate: true, ...mapJobToResponse(existing[0]) }
   }
4. // Extract
   const extracted = await extractJobFromUrl(normalized)
   if (extracted.error) return { success: false, error: extracted.error }
   const job = extracted.job  // ScrapedJob shape
5. // Score
   const profile = await getProfile()
   const keywordScore = scoreKeywords(job)
   const jobForAI = scrapedJobToJobShape(job)  // see "Shape adapter" below
   const aiResult = await scoreWithAI(jobForAI, profile)
6. // Insert
   const externalId = sha256(normalized).slice(0, 16)
   const [inserted] = await db.insert(jobs).values({
     externalId,
     source: "manual",
     sourceUrl: normalized,
     companyName: job.company_name,
     companyDisplayName: job.company_display_name,
     title: job.title,
     description: job.description,
     location: job.location,
     salaryText: job.salary_text,
     salaryMin: keywordScore.salary_min,
     salaryMax: keywordScore.salary_max,
     remotePolicy: keywordScore.remote_policy,
     keywordScore: keywordScore.score,
     // Manual jobs bypass hard filters AND keyword auto-archive
     isActive: true,
     status: "new",
     datePosted: job.date_posted ? new Date(job.date_posted) : null,
     aiScoredAt: new Date(),
     aiScore: aiResult?.score ?? null,
     aiReasoning: aiResult?.reasoning ?? null,
     aiGreenFlags: aiResult?.green_flags ?? null,
     aiRedFlags: aiResult?.red_flags ?? null,
     tier: aiResult?.tier ?? null,
     roleCategory: aiResult?.role_category ?? null,
   }).returning()
7. return { success: true, duplicate: false, job_id, title, company, scores... }
```

**Shape adapter** (`scrapedJobToJobShape`): `scoreWithAI(job: Job, profile)` reads only these fields off the Job: `title`, `companyName`, `companyDisplayName`, `location`, `salaryText`, `description`. The route builds a partial-Job-shaped object for this single call:

```ts
function scrapedJobToJobShape(s: ScrapedJob): Pick<Job, "title" | "companyName" | "companyDisplayName" | "location" | "salaryText" | "description"> {
  return {
    title: s.title,
    companyName: s.company_name,
    companyDisplayName: s.company_display_name,
    location: s.location ?? null,
    salaryText: s.salary_text,
    description: s.description ?? null,
  };
}
```

Cast the result to `Job` at the call site (`as Job`) since the other Job fields aren't read. **Don't refactor `scoreWithAI`** — its signature is stable and this is the only caller that needs the adapter.

**Filter bypass:** the existing pipeline's `applyHardFilters()` is NOT called in this route. `auto_archive` from `scoreKeywords()` is also ignored. Manual jobs always insert with `isActive=true, status="new"`.

## Extraction (`src/lib/scoring/extract.ts`)

```ts
export interface ExtractResult {
  job?: ScrapedJob;          // the snake_case shape from src/lib/types.ts
  error?: "unreachable" | "auth_gated" | "not_a_job" | "extraction_failed";
}

export async function extractJobFromUrl(url: string): Promise<ExtractResult>;
```

**Step 1: fetch the page.**
- Use the same User-Agent string as the Wave A scrapers (Chrome on macOS).
- `signal: AbortSignal.timeout(15000)`.
- Follow redirects (`fetch` does by default).
- If `!res.ok` → return `{ error: "unreachable" }` with a console log of the status.
- If status 200 but body length < 500 chars → likely a soft block / auth wall. Return `{ error: "auth_gated" }`.
- If the body contains both "sign in"/"log in" AND the body is < 5000 chars → return `{ error: "auth_gated" }` (catches login interstitials that still serve 200).

**Step 2: try JSON-LD extraction.**
- Use cheerio to find `<script type="application/ld+json">` blocks.
- Parse each. Look for one with `@type === "JobPosting"` (or `@type` array containing it).
- Extract: `title`, `hiringOrganization.name`, `description`, `jobLocation.address.addressLocality` + `addressRegion`, `baseSalary` (various shapes), `datePosted`.
- If we got both a non-empty `title` AND a description ≥ 200 chars after HTML-stripping → use this. Return success.
- Otherwise discard the JSON-LD attempt and fall through.

**Step 3: Claude fallback.**
- Pre-clean the HTML: remove `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>` (the obvious noise). Use cheerio.
- If still > 20,000 chars, truncate to 20,000.
- Build a focused prompt asking Claude to extract `{title, company_name, location, salary_text, description, remote_policy}` as JSON. Same model as scoring (`AI_SCORING_MODEL` from constants).
- Parse the response. If `title` is null/empty AND `description` is null/empty → return `{ error: "not_a_job" }`.
- If the call fails (network, rate limit, parse error) → return `{ error: "extraction_failed" }`.
- Otherwise build a `ScrapedJob` and return success.

**`ScrapedJob` shape for manual jobs:**
- `external_id` is set by the route (not the extractor), via `sha256(normalizedUrl).slice(0, 16)`.
- `source` = `"manual"` (set by route).
- `source_url` = the normalized URL (set by route).
- `company_name` and `company_display_name` both get the extracted company. (For scraped jobs `company_name` is the ATS slug; for manual jobs there's no slug, so both fields share the human name.)
- All other fields come from the extractor.

**Extractor returns the snake_case shape exclusively** so callers can pipe it directly into `scoreKeywords()` (which takes `ScrapedJob`).

## Dashboard UI: `<UrlBar />`

**Placement:** in `<Dashboard />`, between `<Topbar />` and `<StatsBar />`.

**Layout:** single horizontal row, 44px tall (matches the topbar's visual weight). Full width:

```
┌───────────────────────────────────────────────────────────────────┐
│ 🔗 Paste any job URL...                                  [Score]  │ ← UrlBar (44px)
├───────────────────────────────────────────────────────────────────┤
│ Active 330 │ New today 12 │ Score 87/71/42 │ ... │                │ ← StatsBar (existing)
```

- Input is the dashboard's standard text input (warm palette, focused border in amber).
- Score button: bordered amber, disabled when input is empty or while a paste is in-flight.
- Placeholder: `Paste any job URL — Greenhouse, Lever, Ashby, or any HTML page`
- No icon emoji in the actual UI — the 🔗 in the mockup is just for the spec; use the dashboard's existing icon style (inline SVG, dim color).

**Staged loading state.** When the user clicks Score (or presses Enter):
1. Input disabled, button text → `Fetching…`
2. (After fetch completes, before extraction returns) button → `Extracting…`
3. (After extraction returns, before AI scoring returns) button → `Scoring…`
4. Toast on completion: see below

These transitions are driven by **the server's response progress**, not by client-side timers. Since the route is a single POST, the client can't observe sub-stages without streaming or polling. **For v1 we don't stream** — instead, the button cycles through the three labels on a fixed timer (e.g., 0s → Fetching, 3s → Extracting, 9s → Scoring) so the user sees progress feedback even if it's approximate. This is a UX honesty trade-off: the labels are illustrative, not real-time. Real-time progress would require server-sent events or chunked transfer encoding which is a different scope. Documented behavior, not deception.

If the request takes < 15s the cycle finishes before reaching `Scoring…`, which is fine.

**Success path:**
1. Toast (top-right, autoclose 5s): `"Scored: {title} @ {company} — {score}/100"`. Toast has a link that selects the new row in the dashboard.
2. The new job is pushed to local `jobs` state via a callback. It appears at the top of the table (default sort is by score descending; new job sorts naturally).
3. Input clears.

**Duplicate path:**
1. Toast: `"Already tracking — {title} @ {company} ({score}/100)"`. Link in toast jumps to the existing row.
2. Input clears.
3. Local `jobs` state is unchanged (the row was already there).

**Error path:**
Toast with descriptive message, color-coded danger. Input retains the URL so the user can retry or adjust.

| Error code | User-facing message |
|---|---|
| `invalid_url` | "That doesn't look like a URL" |
| `unreachable` | "Couldn't reach that page" |
| `auth_gated` | "This page requires login" |
| `not_a_job` | "This doesn't look like a job posting" |
| `extraction_failed` | "Found the page but couldn't extract the job details" |
| `internal` | "Something went wrong — try again" |

**Manual source badge.** Jobs with `source === "manual"` get a small badge in the dashboard's Company column or row. **Spec choice:** a `·M·` dim mono character after the company name in the table (subtle, doesn't need a legend, matches the dense visual style). Detail panel shows the badge more explicitly with text "Manually added".

## Vercel Configuration

`vercel.json` adds the new route:

```json
{
  "functions": {
    "src/app/api/cron/scrape/route.ts": { "maxDuration": 60 },
    "src/app/api/scrape/route.ts":      { "maxDuration": 60 },
    "src/app/api/jobs/score-url/route.ts": { "maxDuration": 60 }
  }
}
```

The route does: fetch (≤15s) + JSON-LD parse (instant) + Claude extract (≤10s) + keyword score (instant) + Claude AI score (≤10s) + DB insert (instant). Worst case ≈ 35–40 seconds. 60s leaves safety margin.

## Error Handling Details

- **Network failures during fetch** → caught, returned as `unreachable`.
- **JSON-LD parse errors** → swallowed silently, fall through to Claude.
- **Claude API down** → if it's down during *extraction*, return `extraction_failed`. If it's down during *scoring*, **insert the job anyway** with `aiScore = null` (the user still gets a row with keyword score; AI fields can be backfilled later by manually re-scoring). Same pattern the cron pipeline uses.
- **DB unique constraint race** (two simultaneous pastes of the same URL): caught and converted to a duplicate response.
- **Profile not set** → `getProfile()` falls back to `DEFAULT_PROFILE` — no special handling needed.
- **Uncaught exceptions anywhere in the pipeline** → wrapped in `try/catch` at the route handler level, logged via `console.error`, return `{ success: false, error: "internal" }` with HTTP 500. The toast surfaces this as a generic "Something went wrong — try again" so the user has a path forward.

## Out of Scope

Explicitly NOT in this spec:

- **Streaming progress to the client** (SSE / chunked). The button labels cycle on a fixed timer instead. Real-time progress is a v2 concern.
- **Greenhouse/Lever/Ashby URL shortcuts** (hitting the platform JSON APIs directly). JSON-LD path handles these naturally. v2 if extraction quality on those domains turns out to be poor.
- **Bulk URL paste** (one paste, multiple URLs). Single URL per submission.
- **Editing extracted fields before scoring.** If extraction gets the company wrong, you get a wrong score — you can edit notes/status on the resulting row but not re-trigger the extraction with corrections.
- **Re-scoring existing manual rows.** Once inserted, the score is what it is. The Danger Zone's "Reset all AI scores" still works (it nulls everything including manual rows).
- **Caching extraction results.** Each paste hits the live URL. Re-pasting the same URL hits the dedup path and returns the existing row without re-extracting.
- **A separate "manual" tab in the dashboard.** Manual jobs interleave with scraped jobs, distinguished only by the `·M·` badge.
- **PDF / non-HTML job postings.** The extraction expects HTML. If `Content-Type` isn't HTML, return `extraction_failed`.

## Manual Verification

Before claiming complete:

- Paste a Greenhouse posting URL (e.g., from one of the existing watched companies) → JSON-LD extraction succeeds, row inserts with `source='manual'`, dashboard shows the new row at top.
- Paste the same URL again → returns duplicate, no new row, toast says "Already tracking".
- Paste a Lever posting URL → same as above.
- Paste an Ashby posting URL → JSON-LD or Claude extraction succeeds.
- Paste a URL with tracking params (`?utm_source=linkedin`) → dedup correctly matches against the un-tracked version.
- Paste a URL that 404s → toast `Couldn't reach that page`. No row inserted.
- Paste a LinkedIn job URL (likely auth-gated) → toast `This page requires login`. No row inserted.
- Paste a non-job URL (e.g., the homepage of a company) → either `extraction_failed` or `not_a_job` toast. No row inserted.
- Paste an obviously malformed URL → `That doesn't look like a URL`.
- Verify a manual row in the DB: `SELECT source, source_url, external_id, ai_score FROM jobs WHERE source='manual' LIMIT 5`. external_id is a 16-char hex.
- `npm run build` and `npm run lint` clean (only the 3 pre-existing scraper warnings).
- Cross-browser smoke (Safari, Chrome) on the URL bar.
- Verify `vercel.json` includes the new route's `maxDuration` (otherwise the production button will time out at 10s).
