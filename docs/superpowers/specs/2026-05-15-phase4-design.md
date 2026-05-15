# Phase 4 Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation plan

## Summary

Phase 4 expands the job-agent in five directions: **aggregator scrapers** (BuiltInNYC, NYFA, We Work Remotely) and **custom institution scrapers** (MoMA, Whitney, New Museum) bring jobs from places we'd never watch individually; a **company discovery** Settings tab lets the user add a Greenhouse/Lever/Ashby company by name; an **email digest** delivers daily morning summaries via Resend; and **score insights** uses Claude to analyze the "stretch" range (40–65) and surface skill gaps. The unifying theme is fragility — HTML scrapers will break, and the spec emphasizes loud structured failures over silent degradation.

## Ship Boundaries

This spec is one design, but execution can ship in waves. Three logical groupings, each independently deployable:

- **Wave A — Scrapers** (Features 1, 2): aggregator + museum scrapers, infrastructure for custom dispatch, surfaced in existing Settings Companies tab. No new UI surfaces beyond what the Settings page already has.
- **Wave B — UI features** (Features 3, 5): Discovery and Score Insights tabs. Adds two new Settings tabs and three new ATS-probe routes.
- **Wave C — Email digest** (Feature 4): notification preferences, Resend integration, cron-end hook. Touches the cron pipeline.

The implementation plan can decide whether to split into multiple PRs or ship as one. The features have no hard dependencies between waves — A doesn't require B or C to ship, etc.

## Architecture

**No new top-level routes.** Everything mounts inside `/settings` (new tabs) or extends the existing cron pipeline.

**Five new server modules:**
- `src/lib/scrapers/aggregators/` — three HTML scrapers (`builtinnyc.ts`, `nyfa.ts`, `weworkremotely.ts`)
- `src/lib/scrapers/custom/` — three institution scrapers (`moma.ts`, `whitney.ts`, `new-museum.ts`) plus an `index.ts` registry
- `src/lib/discovery/probe.ts` — `probeCompany(name): Promise<DiscoveryResult>`
- `src/lib/notifications/digest.ts` — `buildDigest()` and `sendDigest()` using the Resend SDK
- `src/lib/insights/analyze.ts` — `analyzeScoreGaps()` Claude call + caching

**Three new client components:**
- `src/components/settings/DiscoverTab.tsx`
- `src/components/settings/NotificationsTab.tsx` (notification preferences)
- `src/components/settings/InsightsTab.tsx`

**Two new API routes:**
- `POST /api/discover` — probes for a company by name, returns the result
- `POST /api/insights/refresh` — recomputes score insights, returns the result

**Pipeline changes:**
- `src/lib/pipeline/scrape.ts` gains a `custom` ATS branch that dispatches via `watched_companies.custom_scraper` to the registry
- After AI scoring, the pipeline calls `maybeRunDigest()` which fires Resend if today matches user preference

**Settings tab additions:**
- The existing `Settings.tsx` adds three tabs: `Discover`, `Notifications`, `Insights`
- Tab values extend the union: `profile | filters | companies | discover | notifications | insights | danger`

## Schema Changes

```ts
// Add to watched_companies:
customScraper: text("custom_scraper"),   // nullable; populated when ats='custom'
```

```ts
// Settings rows added at runtime (no schema change — uses existing settings table):
// key='notifications' → JSON: { email: string, frequency: "daily"|"weekdays"|"manual", paused: boolean }
// key='insights' → JSON: { lastRefreshedAt: ISO string, content: string }
```

`npm run db:push` after adding the column.

## Feature 1: Aggregator Scrapers — Wave A

**Files:**
- `src/lib/scrapers/aggregators/builtinnyc.ts`
- `src/lib/scrapers/aggregators/nyfa.ts`
- `src/lib/scrapers/aggregators/weworkremotely.ts`
- `src/lib/scrapers/custom/index.ts` (registry, shared with Feature 2)
- `src/lib/scrapers/index.ts` (existing — extend `case "custom"` to dispatch via registry)
- `/api/seed` route — add new pseudo-company rows for the three aggregators

**Pseudo-company model:** each aggregator gets a row in `watched_companies`:

```ts
{ name: "BuiltInNYC", ats: "custom", customScraper: "builtinnyc", boardUrl: "https://builtinnyc.com/jobs?…", category: "tech", priority: 2 }
{ name: "NYFA",       ats: "custom", customScraper: "nyfa",       boardUrl: "https://nyfa.org/jobs",        category: "art_world", priority: 1 }
{ name: "We Work Remotely", ats: "custom", customScraper: "weworkremotely", boardUrl: "https://weworkremotely.com/categories/remote-programming-jobs", category: "tech", priority: 2 }
```

The pipeline scrapes them like any other company. Per-job employer info goes into `job.company_name` / `company_display_name` extracted from each listing — the **watched company is the aggregator**, the **actual employer is in the job row.** When a user views these in the dashboard, the Company column shows the actual employer (e.g., "Stripe via BuiltInNYC" — see "Cross-aggregator dedupe" below).

**Per-aggregator scraper signature:** identical to existing scrapers:

```ts
export async function scrapeBuiltInNYC(company: WatchedCompany): Promise<ScrapeResult>;
```

Each scraper:
1. `fetch(company.boardUrl)` with a 15s timeout, a polite `User-Agent`, and `Accept: text/html`
2. Parses with cheerio
3. **Sanity check before extraction:** confirms at least one expected DOM landmark exists. If the landmark is missing, returns `{ jobs: [], error: "parser_assumption_failed: builtinnyc missing 'div.job-card'" }`.
4. Iterates job cards, extracts title/company/location/URL/description (or description snippet — see below)
5. Returns `ScrapedJob[]` in the existing snake_case shape

**Sanity-check examples (subject to verification against live HTML at implementation time):**

- BuiltInNYC: expects `[data-id="job-card"]` or similar; if absent → fail.
- NYFA: expects `.job-listing` or `.career-item`; if absent → fail.
- WWR: expects `section.jobs ul li.feature` or similar; if absent → fail.

These selectors are illustrative — the implementation will inspect each site's current HTML and pick stable landmarks (e.g., elements with semantic class names rather than generated hashes).

**Description handling:** aggregators usually don't include full descriptions in the listing — they link out. Two paths:

1. **Default: snippet only.** Whatever short description the listing provides goes into `job.description`. The full description is reached via the apply link. AI scoring runs against the snippet — less precise but cheaper.
2. **Optional: follow-link fetch.** If a scraper finds the listing has a stable in-page expandable description (some aggregators do), use it. Don't follow external links — that's a different fragility budget.

**Cross-aggregator dedupe:** the unique constraint is `(external_id, source)`. If the same job appears on BuiltInNYC and on the company's Greenhouse board, both get inserted as separate rows because their sources differ. This is acceptable — both rows score similarly under keyword and AI scoring (similar title/description text → similar score), and the user can mark one as `passed` and ignore the other. We do NOT attempt to deduplicate across sources by title+company, because false positives (different roles with similar titles) are worse than visible duplicates.

**Display in dashboard:** the Company column shows `company_display_name`. For aggregator jobs, the scraper sets `company_display_name` to the actual employer (e.g., "Stripe") and `company_name` to the aggregator slug (`builtinnyc`). The detail panel header can show "Stripe · via BuiltInNYC" — implementation detail, not in the schema.

## Feature 2: Custom Institution Scrapers — Wave A

**Files:**
- `src/lib/scrapers/custom/moma.ts`
- `src/lib/scrapers/custom/whitney.ts`
- `src/lib/scrapers/custom/new-museum.ts`
- `src/lib/scrapers/custom/index.ts` (registry — shared with Feature 1)

**Scope:** three institutions. MoMA, Whitney, New Museum. Brooklyn Museum, Cooper Hewitt, and The Shed are explicitly **out of scope for this spec** — the per-institution pattern will be established and they can be added later by following the same shape.

**Watched_companies rows:**
```ts
{ name: "MoMA",        ats: "custom", customScraper: "moma",       boardUrl: "https://www.moma.org/about/careers/jobs",     category: "museum", priority: 1 }
{ name: "Whitney",     ats: "custom", customScraper: "whitney",    boardUrl: "https://whitney.org/about/job-postings",      category: "museum", priority: 1 }
{ name: "New Museum",  ats: "custom", customScraper: "new_museum", boardUrl: "https://www.newmuseum.org/jobs",              category: "museum", priority: 2 }
```

**Per-institution scraper:** same signature as aggregator scrapers — `scrapeMoma(company: WatchedCompany): Promise<ScrapeResult>`. Same sanity-check-then-parse pattern.

**Dispatch:** `src/lib/scrapers/index.ts`'s `scrapeCompany()` case `"custom"` consults the registry:

```ts
// src/lib/scrapers/custom/index.ts
import { scrapeBuiltInNYC } from "../aggregators/builtinnyc";
import { scrapeNyfa } from "../aggregators/nyfa";
import { scrapeWeWorkRemotely } from "../aggregators/weworkremotely";
import { scrapeMoma } from "./moma";
import { scrapeWhitney } from "./whitney";
import { scrapeNewMuseum } from "./new-museum";

export const CUSTOM_SCRAPERS: Record<string, (c: WatchedCompany) => Promise<ScrapeResult>> = {
  builtinnyc: scrapeBuiltInNYC,
  nyfa: scrapeNyfa,
  weworkremotely: scrapeWeWorkRemotely,
  moma: scrapeMoma,
  whitney: scrapeWhitney,
  new_museum: scrapeNewMuseum,
};

export function getCustomScraper(slug: string | null) {
  if (!slug) return null;
  return CUSTOM_SCRAPERS[slug] ?? null;
}
```

The `scrapeCompany()` switch's `case "custom"` becomes:

```ts
case "custom": {
  const fn = getCustomScraper(company.customScraper);
  if (!fn) {
    return { ...base, error: `Unknown custom_scraper: ${company.customScraper ?? "(null)"}` };
  }
  return fn(company);
}
```

**Settings UI:** the `<CompanyPanel />` exposes `customScraper` as a select when `ats === "custom"`. The options come from a static list mirroring the registry keys.

## Feature 3: Company Discovery — Wave B

**Files:**
- `src/lib/discovery/probe.ts`
- `src/app/api/discover/route.ts`
- `src/components/settings/DiscoverTab.tsx`
- `src/components/settings/Settings.tsx` (mount the new tab)

**Probe logic** (`src/lib/discovery/probe.ts`):

```ts
export interface DiscoveryResult {
  found: boolean;
  ats?: "greenhouse" | "lever" | "ashby";
  slug?: string;
  jobCount?: number;
  boardUrl?: string;
  attempted: string[]; // for debug; list of slugs tried
}

export async function probeCompany(name: string): Promise<DiscoveryResult> {
  const candidates = generateSlugCandidates(name);  // ['linear', 'linearapp', 'linear-inc', 'getlinear']
  // Try all candidate × ATS combos in parallel
  // Return first successful match (jobs.length > 0 OR jobs array present even if empty)
  // Order of preference if multiple match: ashby > greenhouse > lever
  //   (ashby is newer and usually has more accurate data; this is a single-user heuristic)
}

function generateSlugCandidates(name: string): string[] {
  // 'The Browser Company' → ['the-browser-company', 'thebrowsercompany', 'browser-company', 'thebrowser']
  // 'Linear' → ['linear', 'linearapp', 'linear-inc', 'getlinear']
  // Bounded to ~4 candidates per input.
}
```

**Endpoint signatures** (existing knowledge):
- Greenhouse: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs` → `{ jobs: [...] }` on success, 404 on not found
- Lever: `GET https://api.lever.co/v0/postings/{slug}` → `[...]` array of postings on success, 404 on not found
- Ashby: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}` → `{ jobs: [...] }` on success, 401 on not found (Ashby returns 401 for missing slugs — already discovered)

Probe runs all combos with `Promise.allSettled`, 8s timeout each. Returns the first successful match by ATS preference order.

**`POST /api/discover` route:** body `{ name: string }`, returns `DiscoveryResult`.

**`<DiscoverTab />`:**
- Text input + "Find" button
- On submit, calls `POST /api/discover`
- Renders:
  - "Searching…" while pending
  - On success: "Found {name} on {ATS} with {N} open jobs" + a one-click "Add to watched" button. Clicking it POSTs to `/api/companies` with the ats+slug+boardUrl, then toasts "Added — next scrape will pick it up."
  - On failure: "No board found for {name}. Tried: {candidates joined}." Shows a note that the company may be on a different ATS (Workable, Recruitee, etc.) and would need manual addition.

## Feature 4: Email Digest — Wave C

**Files:**
- `src/lib/notifications/email.ts` (currently a stub — replace with implementation)
- `src/lib/notifications/digest.ts` (new — content building)
- `src/lib/pipeline/scrape.ts` (extend with `maybeRunDigest()` at the end)
- `src/components/settings/NotificationsTab.tsx`
- `src/app/api/digest/test/route.ts` — `POST` sends a test digest immediately
- `src/components/settings/Settings.tsx` (mount tab)

**Notification preferences** stored as `settings.key='notifications'`:

```ts
interface NotificationPrefs {
  email: string;                          // defaults to env.NOTIFICATION_EMAIL on first render
  frequency: "daily" | "weekdays" | "manual";
  paused: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  email: "",  // resolved at runtime from env if blank
  frequency: "daily",
  paused: false,
};
```

**`getNotificationPrefs()` resolver** (in `src/lib/settings/notifications.ts`):
- Reads `settings.notifications`. If absent, returns defaults.
- The `email` field falls back to `process.env.NOTIFICATION_EMAIL` when blank.

**Digest content** (`src/lib/notifications/digest.ts`):
- Fetches active jobs scraped today (`date_scraped >= start_of_day_utc`)
- Groups:
  - **Top jobs** — `aiScore >= 70`, grouped by `tier` (1, 2, 3)
  - **Interesting** — `aiScore >= 50 AND aiScore < 70`, flat list
- Counts: total new today, top count, interesting count
- Footer: link to dashboard at `process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001/"`

**Email shape:** plain HTML, warm-mono inline styling matching the dashboard palette where reasonable. Single column, mobile-readable. Subject line: `job-agent: N new (M top picks)` — varies per send.

**Send mechanics** (`src/lib/notifications/email.ts`):
```ts
import { Resend } from "resend";

export async function sendDigest(html: string, subject: string, to: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const resend = new Resend(apiKey);
  await resend.emails.send({ from: "job-agent <noreply@…>", to, subject, html });
}
```

The `from` address requires a verified Resend sender. **For initial deployment, use `onboarding@resend.dev`** (Resend's default sender, no domain verification required, works immediately on a free Resend account). When the user wants to use a custom domain, they verify it in the Resend dashboard and update the hard-coded `from` string in `src/lib/notifications/email.ts`. The spec does NOT make the `from` configurable in the UI — it's one line of code to change, not worth a setting.

**Pipeline integration:** at the very end of `runScrapePipeline()`, after AI scoring:

```ts
try {
  await maybeRunDigest();
} catch (err) {
  console.error("Digest send failed:", err);
  // Don't surface to the caller — the scrape was successful.
}
```

`maybeRunDigest()` consults preferences:
- If `paused === true` → return
- If `frequency === "manual"` → return
- If `frequency === "weekdays"` and today is Saturday or Sunday UTC → return
- If `frequency === "daily"` or weekday match → build and send

**Test digest endpoint:** `POST /api/digest/test` builds and sends the digest immediately, regardless of preferences. Returns `{ ok: true, sentTo: email }` or an error.

**`<NotificationsTab />`:**
- Email text input
- Frequency radio: Daily · Weekdays · Manual only
- Paused toggle
- Save button (PUT `/api/settings/notifications`)
- "Send test digest" button (POST `/api/digest/test`) with toast on success/failure

## Feature 5: Score Insights — Wave B

**Files:**
- `src/lib/insights/analyze.ts`
- `src/app/api/insights/refresh/route.ts`
- `src/components/settings/InsightsTab.tsx`
- `src/components/settings/Settings.tsx` (mount tab)

**Algorithm** (`analyzeScoreGaps()`):

1. Fetch the user's profile via `getProfile()`
2. Fetch up to 15 jobs where `aiScore BETWEEN 40 AND 65 AND isActive = true`, ordered by `aiScore DESC` (the closer-to-the-line ones first)
3. Build a prompt:

```
You are analyzing a set of job listings that scored 40–65 for fit with this candidate. These are "stretch" jobs — close to interviewing range but not over the line. Identify what's holding them back.

## Candidate profile
{profile}

## Stretch jobs (N total)

### {title} @ {company}
{description excerpt, max 600 chars}

[repeat for each job]

## Your task
Identify skills, experiences, or qualifications that appear in 3+ of these jobs that the candidate lacks. For each gap:
1. Name the gap (e.g., "5+ years of management experience")
2. Frequency: how many of the {N} jobs require it
3. Reframe vs. real gap: can the candidate's existing experience be reframed to address this, or is it a genuine gap requiring new skill development?
4. If reframable: suggest a specific framing the candidate could use in resumes / cover letters
5. If real: suggest a concrete next step (course, project, certification, role)

Respond in plain markdown, sectioned by gap. Be specific, not generic.
```

4. Call Claude with the same model as scoring (`AI_SCORING_MODEL`), `max_tokens: 2000`
5. Save result to `settings.key='insights'`: `{ lastRefreshedAt: now, content: text }`

**`POST /api/insights/refresh`:**
- Runs `analyzeScoreGaps()` and stores the result
- Returns `{ lastRefreshedAt, content }`
- If `ANTHROPIC_API_KEY` is unset, returns 503 with a helpful message
- If <10 stretch jobs exist, returns 200 with `{ content: "Not enough stretch jobs (need 10+, have N). Run the scrape a few more times.", lastRefreshedAt: now }` — graceful empty state without burning API spend

**`<InsightsTab />`:**
- Renders the stored `content` as plain `whitespace-pre-wrap` text in a styled div. The Claude prompt asks for markdown output, which renders perfectly readable as plain text (headers like `## Gap 1: Management experience` are still visually obvious). No `react-markdown` dependency.
- "Refresh insights" button at the top right — reuses the existing `<DangerAction />` component from the Danger Zone tab (two-click reveal, since refreshes cost API budget)
- Shows `Last refreshed Xh ago` next to the button
- If no insights cached yet: empty state "No insights computed yet. Click Refresh to analyze your stretch-range jobs."

**No automatic background refresh.** This is by design — user-controlled spend.

## Failure Modes and UI Surfacing

This is the cross-cutting section that ties the spec together. HTML scrapers WILL break. The spec must make this visible, not silent.

**Per-source error visibility:**

The existing `watched_companies.last_error` field is the surface. Every scraper, when it fails its sanity check or hits an unrecoverable error, returns `ScrapeResult` with a structured `error` string:

- `parser_assumption_failed: {source} missing {selector}`
- `http_{status}: {source}`
- `timeout: {source} did not respond in 15s`
- `parse_error: {source} {detail}` (e.g., JSON-LD missing where expected)

These land in `watched_companies.last_error` on each cron run. The Settings Companies tab already shows `ERR` for rows with `last_error != null`, with a tooltip showing the message. **No new UI needed for this** — the existing Settings tab is the dashboard for scraper health.

**Two-strikes rule (deferred):** the spec does NOT require auto-disabling sources after consecutive failures. If a scraper has been broken for a week, the user sees red ERR in Settings and decides whether to fix or pause. Manual is fine at this scale.

**Discovery probe failures:** the probe handles 404 / 401 / timeout per-request via `Promise.allSettled`. The overall function never throws on individual probe failures — it just reports "not found" when no candidate succeeds.

**Email digest failures:** logged but not surfaced. If Resend is down, the scrape still succeeded. The user notices when the email doesn't arrive — there's no "digest dashboard" planned. Acceptable: the user has the actual dashboard if email goes silent.

**Insights failures:** Claude API errors are surfaced directly in the InsightsTab via toast. The cached content stays.

**Schema-drift detection:** every scraper logs its sanity check result with structured fields suitable for future alerting. For now, the visibility is via `scrape_log` and `last_error` in the DB — a future feature could parse these into a "Sources health" view.

## Error Handling

**Scrape pipeline:** unchanged behavior — per-company errors don't fail the whole run. The new aggregator/museum scrapers participate in the existing `Promise.all` batched fanout in `scrapeAll()`. Their errors land in `scrape_log` and `watched_companies.last_error`.

**Discovery 503:** if all ATS endpoints are unreachable (network issue, not slug issues), the route returns 500 with a clear error message. The UI toasts "Discovery failed — try again."

**Digest send failure:** logged to server log, not surfaced. The cron route's return JSON includes an `errors[]` field that already exists — digest failure could be appended to that, but isn't surfaced to the user via UI.

**Insights API limit:** if Claude API rate-limits, surface the 429 to the user in the toast with a retry-after hint.

**Notification prefs unsaved:** dirty-state pattern matches ProfileTab and FiltersTab — Save button is amber when dirty, dim when clean.

## Out of Scope

Explicitly NOT in this spec:

- **More than 3 museum scrapers.** Brooklyn Museum, Cooper Hewitt, The Shed. The pattern is established; adding them is straightforward but not on the critical path.
- **Auto-disable sources after N consecutive failures.** Manual review of ERR rows is fine.
- **De-duplication across sources.** A job that appears on BuiltInNYC and on the company's Greenhouse board is two rows. The user marks one and ignores the other.
- **Following apply-out links to fetch full descriptions.** Aggregator snippets only.
- **Workable / Recruitee / SmartRecruiters discovery probes.** Three ATSes is plenty for v1.
- **HTML email theming polish.** Single-column plain HTML is acceptable; designed templates can come later.
- **Digest preview in the UI.** "Send test digest" is the preview mechanism.
- **Multiple notification recipients.** Single email, single user.
- **Insights at per-job granularity.** Aggregate analysis only.
- **Cron-driven insights refresh.** User-controlled only.
- **Test runner.** Per CLAUDE.md, no Vitest. Manual verification only.

## Manual Verification

Before claiming complete:

**Wave A (scrapers):**
- Seed the three aggregator and three museum rows into `watched_companies`. Run `/api/scrape` or `/api/cron/scrape`. Verify each source returns non-zero jobs OR a structured error in `last_error`.
- Confirm a job from BuiltInNYC appears in the dashboard with `company_display_name` set to the actual employer (e.g., "Stripe"), `source='builtinnyc'`.
- Manually break one scraper (point its `boardUrl` to a 404 page) and verify the next cron run records the failure in `last_error` and shows ERR in the Settings Companies tab.

**Wave B (Discovery + Insights):**
- Discover an existing company: probe "Linear" → expect ats=ashby, slug=Linear, jobs>0. Don't add — already in the list.
- Discover a fake company: probe "fakecompanyxyz123" → expect found=false, attempted list shown.
- Discover a known company: probe "Notion" → expect ats=ashby, slug=notion, jobs>0. Click "Add to watched" → confirm row appears in Companies tab.
- Insights with insufficient stretch jobs: ensure <10 jobs in the 40–65 range, click Refresh → expect the "not enough stretch jobs" empty state without an API call.
- Insights with enough stretch jobs: click Refresh → wait for Claude response, verify content renders. Refresh page, verify cached content reappears.

**Wave C (Email digest):**
- Set notifications: email set, frequency=daily, paused=false. Click "Send test digest" → email arrives with today's top + interesting jobs and a link to the dashboard.
- Set paused=true. Trigger the cron. Verify no email is sent.
- Set frequency=weekdays. Trigger the cron on a Saturday (UTC). Verify no email is sent.

**All waves:**
- `npm run build` and `npm run lint` clean. Only the 3 pre-existing scraper warnings.
- Cross-browser smoke (Safari + Chrome) on the new Settings tabs.
- The dashboard's UI is unaffected — no regressions in `/`.
