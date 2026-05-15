# Settings Page Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation plan

## Summary

Add a `/settings` page with four tabs (Profile, Hard Filters, Watched Companies, Danger Zone) that lets the user configure scoring inputs and watched companies through the UI instead of editing source files. The AI scoring prompt's profile and a new "hard filters" set move into a `settings` table; the existing keyword weights and score thresholds stay in code (out of scope). A new `/api/scrape` route lets the Settings UI trigger the scrape pipeline without the GitHub-Actions Bearer secret.

## Architecture

**One new page, four content panels, one shared lib refactor, one new table.**

- New page: `src/app/settings/page.tsx` — server component that reads initial data (profile, hard filters, companies, jobs total count, last scraped) and mounts a client `<Settings />` component.
- New table: `settings` (key/value/updated_at). Two rows in scope: `profile` (text) and `hard_filters` (JSON-encoded shape).
- Refactor: extract `runScrapePipeline()` from `src/app/api/cron/scrape/route.ts` into `src/lib/pipeline/scrape.ts`. Both `/api/cron/scrape` (Bearer-gated, for GitHub Actions) and `/api/scrape` (open, for the Settings button) call it.
- The AI scorer reads the profile from the DB at runtime, falling back to a hard-coded default when the row doesn't exist.
- Hard filters are read at scrape time and a job that fails any filter is inserted with `status='passed'`, `isActive=false` — same auto-archive mechanism the keyword `SCORE_THRESHOLD_ARCHIVE = 20` already uses.
- `<Topbar />` reads `usePathname()` and self-selects: "Settings" link on `/`, "← dashboard" on `/settings`. The refresh icon is hidden on `/settings`.

**Files:**

| Path | Purpose |
|---|---|
| `src/app/settings/page.tsx` | Server fetch, mount `<Settings />`. |
| `src/app/settings/error.tsx` | Themed error boundary. |
| `src/components/settings/Settings.tsx` | Tab nav + active panel. Reads `?tab=` query, updates via `router.replace()`. |
| `src/components/settings/ProfileTab.tsx` | Textarea + Save + Save & re-score all (with two-click confirmation). |
| `src/components/settings/FiltersTab.tsx` | Location select, salary number, employment-type checkboxes, Save. |
| `src/components/settings/CompaniesTab.tsx` | Table + side panel + "Run scrape now" button. |
| `src/components/settings/CompanyPanel.tsx` | Slide-over for add/edit/delete (two-click delete reveal). |
| `src/components/settings/DangerTab.tsx` | Reset scores, archive all, export CSV — uses `<DangerAction />`. |
| `src/components/settings/DangerAction.tsx` | Two-click reveal component. |
| `src/components/dashboard/Topbar.tsx` | Modify: pathname-aware link, optional refresh icon. |
| `src/app/api/settings/route.ts` | `GET` all settings as `{ key: value }`. |
| `src/app/api/settings/[key]/route.ts` | `PUT` upsert one setting. |
| `src/app/api/scrape/route.ts` | `POST` triggers `runScrapePipeline()`, no auth. |
| `src/app/api/jobs/export/route.ts` | `GET` returns CSV with `Content-Disposition: attachment`. |
| `src/app/api/jobs/reset-scores/route.ts` | `POST` nulls 5 AI columns on all jobs. |
| `src/app/api/jobs/archive-all/route.ts` | `POST` sets `status='passed'`, `isActive=false` on all jobs. |
| `src/lib/pipeline/scrape.ts` | Extracted `runScrapePipeline()`. |
| `src/lib/settings/profile.ts` | `getProfile()`, `DEFAULT_PROFILE` constant. |
| `src/lib/settings/hard-filters.ts` | `getHardFilters()`, `applyHardFilters()`, `DEFAULT_HARD_FILTERS`. |
| `src/lib/db/schema.ts` | Add `settings` table. |
| `src/lib/scoring/ai-scorer.ts` | Refactor: `scoreWithAI(job, profile)` takes profile as a second argument. Callers (currently just `runAIScoring`) fetch the profile **once** at the start of the cron run and pass it in — not per-job. Avoids N round-trips per run. |
| `src/app/api/cron/scrape/route.ts` | Reduce to a thin Bearer-gated wrapper around `runScrapePipeline()`. |

After schema change: `npm run db:push`. No backfill — `getProfile()` and `getHardFilters()` return their defaults when the rows don't exist.

## Schema and Data Model

**New table:**

```ts
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Two keys in scope:**

| Key | Value shape (post-parse) | Default |
|---|---|---|
| `profile` | string (multi-line text) | `DEFAULT_PROFILE` constant in `src/lib/settings/profile.ts`, equal to the current literal block in `ai-scorer.ts` |
| `hard_filters` | `{ location, salaryFloor, employmentTypes }` (see below) | `DEFAULT_HARD_FILTERS` |

**HardFilters shape:**

```ts
export interface HardFilters {
  location: "nyc_only" | "remote_only" | "nyc_remote" | "all";
  salaryFloor: number;
  employmentTypes: ("full_time" | "temp_to_perm")[];
}

export const DEFAULT_HARD_FILTERS: HardFilters = {
  location: "nyc_remote",
  salaryFloor: 110000,
  employmentTypes: ["full_time", "temp_to_perm"],
};
```

**Resolver helpers:**

```ts
// profile.ts
export async function getProfile(): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, "profile")).limit(1);
  return row[0]?.value ?? DEFAULT_PROFILE;
}

// hard-filters.ts
export async function getHardFilters(): Promise<HardFilters> {
  const row = await db.select().from(settings).where(eq(settings.key, "hard_filters")).limit(1);
  if (!row[0]) return DEFAULT_HARD_FILTERS;
  try {
    return { ...DEFAULT_HARD_FILTERS, ...JSON.parse(row[0].value) };
  } catch {
    return DEFAULT_HARD_FILTERS;
  }
}

/**
 * Returns whether a scraped job passes all hard filters.
 * Called at insert time in the scrape pipeline.
 */
export function applyHardFilters(
  job: ScrapedJob,
  scored: { salary_min: number | null; salary_max: number | null; remote_policy: RemotePolicy | null },
  filters: HardFilters
): { passes: boolean; reason: string | null } {
  // location
  if (filters.location !== "all") {
    const wantsNyc = filters.location === "nyc_only" || filters.location === "nyc_remote";
    const wantsRemote = filters.location === "remote_only" || filters.location === "nyc_remote";
    const isNyc = scored.remote_policy === "onsite" || scored.remote_policy === "hybrid";
    const isRemote = scored.remote_policy === "remote" || scored.remote_policy === "hybrid";
    if (!((wantsNyc && isNyc) || (wantsRemote && isRemote))) {
      return { passes: false, reason: "location" };
    }
  }
  // salary floor — only excludes if we KNOW the salary is below. Unknown lets it through.
  if (scored.salary_max != null && scored.salary_max < filters.salaryFloor) {
    return { passes: false, reason: "salary" };
  }
  // employment type — keyword exclude on description+title when temp_to_perm is unchecked
  if (!filters.employmentTypes.includes("temp_to_perm")) {
    const desc = (job.description ?? "").toLowerCase();
    const title = job.title.toLowerCase();
    const tempTerms = ["contract", "1099", "temp-to-perm", "freelance"];
    if (tempTerms.some(t => desc.includes(t) || title.includes(t))) {
      return { passes: false, reason: "employment_type" };
    }
  }
  // full_time has no negative keywords — almost every posting reads as full-time
  // without saying so. If unchecked, no filter is applied. Documented in UI.
  return { passes: true, reason: null };
}
```

**Insert-time integration:** in `src/lib/pipeline/scrape.ts` (the extracted version), the `dedupeAndInsert` helper computes `scoreKeywords(job)` (existing), then calls `applyHardFilters(job, score, filters)`. If `passes === false`, the job is inserted with `status='passed'`, `isActive=false`, regardless of keyword score. The existing keyword `auto_archive` flag still applies independently.

**Notes on the salary rule:** "exclude only when known-below." Most postings don't list salary; treating unknown as failing would archive 70%+ of the pipeline.

**Notes on `full_time` unchecked:** there's no good negative-keyword set for "this isn't full time." If unchecked, no filter applied. Help line in UI documents this.

## Tab Navigation and Routing

The four tabs live under a single `/settings` route. Active tab is reflected in a `?tab=...` query param.

- Valid tab values: `profile` | `filters` | `companies` | `danger`
- Default when no query param: `profile`
- Invalid value: silently fall back to `profile` and rewrite the URL via `router.replace()`
- Tab switching is client-side via `useSearchParams()` + `router.replace()` so back/forward navigation works

**Tab bar visual:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ job-agent  ·  / settings                                ← back to /     │ ← Topbar (36px), reused
├──────────────────────────────────────────────────────────────────────────┤
│  Profile     Hard Filters     Watched Companies     ● Danger Zone        │ ← tab bar (36px)
│                                ─────────                                 │   active = warm primary text + amber underbar
├──────────────────────────────────────────────────────────────────────────┤
```

Danger tab gets a tiny dim `●` in danger color before its label — a soft warning. The tab's content does the heavier visual lifting.

**Topbar changes** (`src/components/dashboard/Topbar.tsx`):
- Read `usePathname()` and render "Settings" link when `pathname === "/"`, "← dashboard" when `pathname.startsWith("/settings")`.
- Refresh icon now optional: `onRefresh?: () => Promise<void>`. Dashboard passes one; Settings doesn't. Icon hidden when `onRefresh` is undefined.
- `lastScraped` prop continues to display on both routes.

## Tabs — Content and Behavior

### Profile

- **Textarea** — 15 rows, auto-grows, full-width. Sans-serif (the profile is prose, not tabular data — matches the rest of the app's body text). Pre-populated with `getProfile()` value (or `DEFAULT_PROFILE`).
- Two buttons below, right-aligned: **Save** and **Save & re-score all**.
  - `Save` → `PUT /api/settings/profile` with the textarea value. Toast on success ("Saved") and failure.
  - `Save & re-score all` → uses the two-click reveal pattern (first click replaces the button text with `"Confirm: re-score all 1308 jobs?"`, same in-place replacement as the danger zone). On confirm: PUT settings first, then `POST /api/jobs/reset-scores`. If the PUT succeeds and the POST fails, the profile is saved but scoring isn't reset — surface a toast `Profile saved but score reset failed — retry` with a Retry button that fires just the reset. Do NOT roll back the profile save.
- Dirty state: when textarea content !== loaded value, both Save buttons show in primary text + amber accent. Clean state, they're dim.
- No optimistic update — sit-and-think action, not fast-flip. Save → wait for 200 → toast.

### Hard Filters

Three fields, vertical stack, generous spacing:

- **Location** — `<select>`: NYC only · Remote only · NYC + Remote · All
- **Salary floor** — number input, default 110000, range 0–500000. Help line: "Jobs with a stated max salary below this are auto-archived. Jobs without listed salary are not filtered."
- **Employment type** — checkboxes: ☑ Full-time · ☑ Temp-to-perm. Help line: "Temp/contract: when unchecked, excludes jobs mentioning contract, 1099, freelance, or temp-to-perm in title or description."

One **Save** button at the bottom. PUT `/api/settings/hard_filters` with `JSON.stringify(currentState)`. Same dirty-state behavior as Profile.

Dim italic line above Save: "Changes apply to jobs scraped from now on. Existing jobs are unaffected."

### Watched Companies

**Header (sticky inside the tab):**
```
Watched Companies · 16 active · last scraped 2h ago        [+ add]   [Run scrape now]
```

- "16 active" count updates live as you add/delete.
- "last scraped Xh ago" derived from `max(watchedCompanies.last_scraped)`. After scrape-now: updates to "just now".
- `+ add` opens `<CompanyPanel />` empty.
- `Run scrape now` → `POST /api/scrape`. Button text becomes "Scraping…" and disables. On 200, result line appears below the header for 10s: `Scraped 16 companies · 47 new · 8 errors`. Error count is danger-red and clickable (expands a tiny panel listing the per-company error strings). On 500, button restores and toast surfaces error.

**Table** (grid, no scroll until 50+ rows — comment in file documents the threshold):

```
Name | ATS | Board URL | Category | Pri | Last | Status
```

- Click row → `<CompanyPanel />` slides from right (`min(640px, 50vw)`, same pattern as dashboard's job detail).
- Status column: `OK` (dim, no `last_error`), `ERR` (danger red text, has `last_error`, tooltip shows the message), `inactive` (60% opacity row, dim text).
- Inactive rows still appear in the list — visible but de-emphasized.
- TODO comment at top of `CompaniesTab.tsx`: `// TODO: pagination when company count > 50 (currently inlined scroll)`.

**`<CompanyPanel />` fields:**
- Name (text input)
- ATS (`<select>`: greenhouse · lever · ashby · custom)
- Board URL (text, full width)
- Category (`<select>`: existing `CompanyCategory` union)
- Priority (number, 1–3)
- Active (checkbox)
- `last_scraped` and `last_error` rendered read-only at bottom for context

Buttons: **Save** (primary amber), **Cancel** (dim), and on far right in danger color: **Delete** (two-click reveal — first click reveals "Confirm: delete Linear?"). Delete calls existing `DELETE /api/companies` which soft-deletes (`is_active = false`). The row stays in the table at 60% opacity until hard-deleted from DB. The panel's Active checkbox is the inverse path.

Add uses the same panel with empty fields, Save calls `POST /api/companies`.

### Danger Zone

Three rows in a danger-color tinted panel:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ! Danger Zone — these actions are destructive and not always reversible. │
├──────────────────────────────────────────────────────────────────────────┤
│ Reset all AI scores                                                       │
│ Nulls ai_scored_at on all jobs so the next scrape re-scores them.        │
│ Affects 1308 jobs · re-running AI scoring costs API tokens.    [Reset]   │
├──────────────────────────────────────────────────────────────────────────┤
│ Archive all jobs                                                          │
│ Sets status='passed' and is_active=false on every job. Use to clear     │
│ the dashboard for a fresh start. Existing notes/status are overwritten. │
│ Affects 1308 jobs.                                            [Archive]  │
├──────────────────────────────────────────────────────────────────────────┤
│ Export jobs as CSV                                                        │
│ Downloads the full jobs table (1308 rows) with all columns.              │
│                                                              [Download]  │
└──────────────────────────────────────────────────────────────────────────┘
```

- Each row uses `<DangerAction />` for the two-click reveal.
- Live job counts ("1308 jobs") fetched from `/api/jobs?active=false&limit=1` `.total` on page load.
- **Reset** → `POST /api/jobs/reset-scores` → toast "Reset 1308 jobs."
- **Archive** → `POST /api/jobs/archive-all` → toast "Archived 1308 jobs."
- **Export** — single click (not destructive). Hits `GET /api/jobs/export`. Browser handles the download via `Content-Disposition: attachment; filename="jobs-YYYY-MM-DD.csv"`.

Two new micro-routes for the destructive actions. The existing `PATCH /api/jobs` requires an `ids` array; adding a "match all" mode would muddy that contract.

## Error Handling

**Save failures:**
- Profile and Hard Filters: PUT failure → toast (`Save failed`) with Retry. Local state stays dirty.
- Company add/edit/delete: failure → same toast pattern. Panel stays open.

**Scrape failures:**
- 500 (pipeline threw) → toast `Scrape failed — retry`. No result line.
- 200 with errors → result line shows counts and errors. Error count is clickable, expands a tiny per-company error panel.

**Danger action failures:**
- Reset / archive failure → toast with Retry. Page state unchanged.
- Export failure → toast with Retry. Browser native download UI also shows the failure.

**Empty / loading:**
- Server-rendered first paint, no loading spinner.
- After add/edit/delete and after scrape-now: companies list re-fetches. Rows just update, no spinner.
- Empty companies list: centered dim `No companies. Add one with + add or run /api/seed.`

**Error boundary:**
- `src/app/settings/error.tsx` matches the dashboard's `error.tsx` styling, message `"Couldn't load settings"`.

**Routing edge cases:**
- `/settings?tab=invalid` → silently shows Profile and rewrites URL.

## Schema Migration

```ts
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Run `npm run db:push` after the schema change. No data migration — defaults are computed by the resolvers when rows don't exist.

## Out of Scope

Explicitly NOT in this spec:

- **Editing `POSITIVE_SIGNALS` / `NEGATIVE_SIGNALS` in the UI.** Keyword weights stay in `src/lib/constants.ts`.
- **Score thresholds (`SCORE_THRESHOLD_*`).** Stay in constants.
- **Auth on /api/scrape, /api/jobs/reset-scores, /api/jobs/archive-all, /api/jobs/export, /api/settings.** Single-user app; gating some routes and not others is theater.
- **Test runner** — none. Manual verification per CLAUDE.md.
- **Light mode** — variables only.
- **Mobile responsive** — `/settings` inherits the dashboard's `<1024px` "Open on desktop" gate.
- **Activity log / audit trail** for destructive actions.
- **Undo** for danger actions — two-click reveal is the only friction.
- **Pagination on Companies table** — TODO comment marks the 50-row trigger.
- **Deep-linking to a specific company** (`?company=<id>`) — URL has room for it but no behavior wired.

## Manual Verification

Before claiming complete:

- Load `/settings`. All four tabs render. URL updates on tab change. Refresh keeps tab.
- Profile: edit textarea, click Save, refresh — value persists in DB and UI. Click "Save & re-score all" with two-click confirmation. Query DB: `SELECT count(*) FROM jobs WHERE ai_scored_at IS NULL;` returns 1308.
- Hard Filters: change each field, click Save, refresh — values persist. Trigger a scrape via Companies tab. Verify a job that fails the new filters lands with `status='passed'`, `is_active=false` (DB query).
- Companies: add a fake company. Edit it. Delete it (two-click reveal). Run scrape now — result line appears with non-zero numbers, last_scraped updates to "just now", dashboard reflects new jobs after navigating back.
- Danger Zone: reset scores → `SELECT count(*) FROM jobs WHERE ai_scored_at IS NULL;` returns the total job count. Archive all → `SELECT count(*) FROM jobs WHERE is_active = true;` returns 0. Export CSV → file downloads with all columns and opens in Excel/Numbers.
- Topbar: confirm "Settings" link on `/` and "← dashboard" on `/settings`. Refresh icon hidden on `/settings`.
- Narrow-viewport gate at <1024px shows "Open on desktop".
- `npm run build` and `npm run lint` both clean (only the 3 pre-existing scraper warnings).
- Smoke test in Safari and Chrome.

Will NOT claim "tests pass" — there are none. Will report "manual verification ran" with the checklist above.
