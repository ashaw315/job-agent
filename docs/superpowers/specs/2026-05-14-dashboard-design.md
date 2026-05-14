# Dashboard Design

**Date:** 2026-05-14
**Status:** Approved, ready for implementation plan

## Summary

Replace `src/app/page.tsx` (currently the Next.js starter) with a single-page job-triage dashboard. Linear/Raycast-inspired: dark mode default, dense table primary, slide-over detail panel, keyboard-first interaction. No new server routes — existing `/api/jobs` and `/api/jobs PATCH` are sufficient. Schema gains two columns (`green_flags`, `red_flags`) so the AI scorer's existing output can populate the detail panel.

## Architecture

**Server side, no new routes.** `src/app/page.tsx` becomes a thin server component that fetches the active job set and passes it as a prop to a `"use client"` `<Dashboard />`. SSR'd first paint, then full client-side interactivity. No data-fetching library — one fetch on mount is the entire client/server contract from the browser. Mutations go through the existing `PATCH /api/jobs`.

**Client side, single component tree:**

```
<Dashboard initialJobs>          // owns all state
├── <Topbar />                   // brand, last-scraped, manual refresh
├── <StatsBar />                 // five cells of derived counts
├── <FilterBar />                // status/tier/score/archived/search
├── <JobTable />                 // filtered + sorted rows, owns focus
└── <DetailPanel />              // slide-over, conditionally rendered
```

**Files:**

| Path | Purpose |
|---|---|
| `src/app/page.tsx` | Server component. Fetches active jobs, renders `<Dashboard />`. |
| `src/app/layout.tsx` | Update metadata, set `<html data-theme="dark">`, keep Geist mono variable. |
| `src/app/globals.css` | Replace with warm-mono palette as CSS variables under `:root[data-theme="dark"]`. |
| `src/app/error.tsx` | Themed error boundary for fetch failures. |
| `src/components/dashboard/Dashboard.tsx` | Top-level client component, all state. |
| `src/components/dashboard/Topbar.tsx` | Brand + last-scraped + refresh. |
| `src/components/dashboard/StatsBar.tsx` | Derived counts. |
| `src/components/dashboard/FilterBar.tsx` | Filter chips + search input. |
| `src/components/dashboard/JobTable.tsx` | Grid table, owns row focus ring. |
| `src/components/dashboard/DetailPanel.tsx` | Slide-over, PATCH mutations. |
| `src/components/dashboard/Toast.tsx` | Tiny bottom-left error toast. |
| `src/lib/format.ts` | `relativeDate`, `scoreDisplay`, `tierColor`. |
| `src/lib/db/schema.ts` | Add `greenFlags`, `redFlags` text columns to `jobs`. |
| `src/lib/scoring/ai-scorer.ts` | Persist `greenFlags` and `redFlags` from API response. |
| `src/app/api/cron/scrape/route.ts` | Map flags into the update statement. |

After schema change: run `npm run db:push`. No backfill — existing AI-scored rows show `—` in the flag slots until they're naturally re-scored.

## State Model

`<Dashboard />` owns everything via `useState`. No reducer — the state is small and the transitions are independent.

```ts
const [jobs, setJobs] = useState<Job[]>(initialJobs);
const [showArchived, setShowArchived] = useState(false);
const [filters, setFilters] = useState<Filters>({
  status: null,           // null = all, else "new" | "interested" | "applied" | "interviewing" | "passed"
  tier: null,             // null = all, else 1 | 2 | 3
  minScore: 0,
  search: "",
});
const [sort, setSort] = useState<Sort>({ field: "score", dir: "desc" });
const [selectedId, setSelectedId] = useState<string | null>(null);
const [focusedId, setFocusedId] = useState<string | null>(null);
```

**Derived with `useMemo`:**

- `visibleJobs` — `jobs` → filter by `showArchived` (gates on `is_active`) and `filters` → sort by `sort`. The `minScore` filter compares against `scoreDisplay(job).value`, not `keywordScore` directly — consistency with what the column actually shows.
- `stats` — derived from `jobs` (the full set, not `visibleJobs`) so the bar reflects reality, not "stats for what you happened to filter to"
- `selectedJob` — `jobs.find(j => j.id === selectedId)`, so the panel always reflects the latest mutated state

**Score display rule** (clarifies "AI score if available, keyword score as fallback"):

```ts
function scoreDisplay(job: Job): { value: number, source: "ai" | "keyword" } {
  return job.aiScore != null
    ? { value: Math.round(job.aiScore), source: "ai" }
    : { value: Math.round(job.keywordScore ?? 0), source: "keyword" };
}
```

Sort by score uses this function so AI-scored and keyword-only jobs interleave by their displayed number. In the Score table cell, AI-sourced scores render in `--text-pri`, keyword-only scores in `--text-sec` — same column, different weight, no extra column.

**PATCH flow (optimistic):**

1. User changes status (dropdown or 1–5 key) or notes (debounced 800ms).
2. `setJobs(prev => prev.map(j => j.id === id ? {...j, ...update} : j))` synchronously.
3. Fire `PATCH /api/jobs` with `{ ids: [id], updates: {...} }`.
4. On failure: revert local change, show toast with retry action.

**Race policy:** rapid status changes (j/k flipping during in-flight saves) — last synchronous local write wins client-side, server is idempotent on these columns so last fetch wins server-side. No request cancellation needed at this scale.

## Layout and Visuals

**Palette (warm mono + amber accent):**

```css
:root[data-theme="dark"] {
  --bg:           #0a0907;
  --bg-row-hover: #100e0a;
  --bg-row-sel:   #16130e;
  --bg-hdr:       #0d0b08;
  --border:       #18150f;
  --text-pri:     #ece8df;
  --text-sec:     #837e72;
  --text-tert:    #5a564d;
  --accent:       #d4a64c;
  --green:        #9ec49e;     /* green-flag block */
  --danger:       #c47e7e;     /* red-flag block, error toast */
}
```

Light mode is not implemented — the variables are scoped so a future `:root[data-theme="light"]` block adds it without touching component code.

**Page chrome (top to bottom):**

1. **Topbar (36px)** — `job-agent` brand left in `--text-sec` mono, `Last scraped 2h ago` and circular-arrow refresh icon right. Manual refresh re-fetches `/api/jobs` and replaces `jobs`. Last-scraped derived from the most recent `last_scraped` value across companies, passed in as a second prop from `page.tsx` to avoid a second round trip.

2. **StatsBar (64px)** — five cells separated by 1px `--border` verticals:
   - **Active** — large 24px tabular-mono number, 10px uppercase dim label
   - **New today** — same. `jobs.filter(j => dateScraped >= todayMidnight && status === "new").length`. Intentionally requires `status === "new"`: count drops as you triage during the day, which is what we want.
   - **Score distribution** — three inline tabular-mono numbers `87 / 71 / 42` (high ≥70, med 40–69, low <40 using `scoreDisplay`)
   - **Pipeline** — four inline counts `new 12 · int 4 · app 2 · itw 1`. Each count is a button that toggles the status filter to its value (clicking the active count clears the filter back to "All").
   - **Boards** — `15 active · 1 error`. Hover shows tooltip listing companies with `last_error != null`.

3. **FilterBar (40px)** — left to right:
   - Status chips: `All · New · Interested · Applied · Interviewing`. Active chip gets an amber underline (not fill — keeps it quiet).
   - Tier chips: `T1 · T2 · T3`. Smaller, dim until active.
   - Min score: small inline numeric input, default 0. Type-to-set, no slider.
   - Search: stretches to fill remaining width. Placeholder `Search title or company…`. Amber focus border. `/` focuses it; cmd-F also focuses it.
   - Far right: `Show archived` 8-char label + switch. When on, includes `is_active = false` jobs.

4. **JobTable** — fills remaining height, scrolls internally; chrome above stays sticky.

   Grid columns:
   ```
   2.4fr Title · 1.3fr Company · 1.4fr Location · 50px Score · 40px T · 80px Status · 50px Date
   ```

   Row height 28px. Sans 12px for content; monospace 11px for Score, T, Date. Sort indicator (amber `▾`/`▴`) appears only on the active sort column header. Sortable headers: title (alpha), company (alpha on `companyDisplayName`), score (via `scoreDisplay`), date (`dateScraped`). Tier and status sort from the header is intentionally disabled — chips do that.

   - Tier numeral color: T1 amber, T2 `--text-pri`, T3 `--text-sec`.
   - Status pill mapping (Palette C):
     - `new` — amber on translucent (`background: rgba(212,166,76,0.14); color: var(--accent)`)
     - `interested` — bordered primary text (`border: 1px solid var(--border); color: var(--text-pri)`)
     - `applied` — bordered dim (`border: 1px solid var(--border); color: var(--text-sec)`)
     - `interviewing` — filled amber inversion (`background: var(--accent); color: var(--bg)`)
     - `passed` — no pill, just dim text `—`
   - `is_active === false` rows render at 60% opacity.

5. **DetailPanel** — fixed right slide-over, width `min(640px, 50vw)`. 200ms transform transition. Backdrop is 30% black, click-to-close. Inside:
   - **Header (44px)**: title 15px primary, small `↗` link icon opening `source_url` in new tab, `×` close. Subtitle 11px dim: `Company · Location · Salary if any` (omit pieces that are null). Right-aligned: score large, `87 / 100` with `/ 100` in dim mono. If keyword-only: `42 (keyword)` instead of `/ 100`.
   - **Status row**: dropdown styled as button, current status. To its right, dim `1 2 3 4 5` keyboard hint.
   - **AI section** (only if `aiReasoning != null`):
     - Reasoning paragraph — plain text, `whitespace-pre-wrap`, no markdown rendering. The AI response is plain prose.
     - Green flags block (`--green` tinted), only if `greenFlags != null && greenFlags !== ""`
     - Red flags block (`--danger` tinted), only if `redFlags != null && redFlags !== ""`
   - **Description**: collapsed disclosure `Description ▸`. Inside, `whitespace-pre-wrap` 12px, max-height with scroll.
   - **Notes**: textarea at bottom, 6-row min, auto-grows. Debounced save (800ms). Status text under it: `Saved · 2s ago` / `Saving…` / `Save failed — retry`.

**Narrow viewports (<1024px):** show a centered "Open on desktop" message instead of attempting responsive layout. Intentional gate, not broken.

## Keyboard Navigation

Two modes, mutually exclusive, gated on whether the panel is open. Global keydown listener; bails when `document.activeElement` is a text input (only `escape` still applies, to blur).

**Table mode (panel closed):**

| Key | Action |
|---|---|
| `j` | Move `focusedId` to next visible row (no wrap, stops at last) |
| `k` | Previous row |
| `enter` | Open panel: `setSelectedId(focusedId)` |
| `/` | Focus search input |
| `gg` | Jump to first row |
| `G` | Jump to last row |
| `escape` | If search focused, blur it; else clear `focusedId` |

**Panel mode (panel open):**

| Key | Action |
|---|---|
| `j` / `k` | Move selection to next/prev row, panel stays open showing new selection — flips through detail views |
| `escape` | Close panel |
| `1` | Set status `new` |
| `2` | Set status `interested` |
| `3` | Set status `applied` |
| `4` | Set status `interviewing` |
| `5` | Set status `passed` |

**Focus mechanics:**
- Focused row: 1px amber left border, distinguishes from hover
- Selected row (panel open): fuller background tint plus the border
- Auto-scroll on j/k: `scrollIntoView({ block: "nearest" })` when cursor leaves viewport
- Notes textarea guard: when notes is focused, j/k yield to default text input behavior — protects unsaved input

## Error Handling

**Server fetch errors:** Initial fetch in `page.tsx` is server-side. On throw, Next's error boundary takes over via `src/app/error.tsx`, themed to match the palette — "Couldn't load jobs · retry". Manual refresh failures show a toast and keep the existing `jobs` state.

**PATCH failures:** Optimistic update commits immediately; on 4xx/5xx, revert local change and show toast `Couldn't update job — retry` with a Retry action that refires the PATCH. Notes save failure shows inline under the textarea (`Save failed — retry`), not as a toast.

**Empty / loading states:**

- No loading spinner — SSR'd initial render means there's never a "no jobs yet" moment.
- `initialJobs.length === 0` (fresh DB): centered message `No jobs yet. Run /api/cron/scrape to populate.` in dim mono with curl example.
- Filtered to zero results: centered `No matches · clear filters`. Clear-filters resets `filters` to defaults.

**Detail panel edge cases:**

- `aiReasoning == null` (keyword-only): hide AI section entirely. Score shows `42 (keyword)`.
- `description == null`: hide disclosure.
- `salaryText == null`: omit from header subtitle.
- Row archived while selected (status → passed, showArchived off): row vanishes from table but panel stays open. Closing returns to table without that row.

## Schema Change

Add to `jobs` table in `src/lib/db/schema.ts`:

```ts
greenFlags: text("green_flags"),
redFlags: text("red_flags"),
```

Both nullable. `src/lib/scoring/ai-scorer.ts` already returns `green_flags` and `red_flags` from the API response — wire them into the persisted shape. `src/app/api/cron/scrape/route.ts`'s `runAIScoring` adds them to the `updates` object alongside `aiScore`/`aiReasoning`/`tier`/`roleCategory`. Run `npm run db:push` after the schema change. No backfill — older AI-scored jobs show `—` in flag slots until naturally re-scored.

## Out of Scope

Explicitly NOT in this spec, will not be implemented as part of the dashboard:

- **Light mode** — variables are scoped to support it; the second theme is not authored
- **Pagination** — single-fetch + scroll for ≤1000 rows. Revisit at ~2000+
- **Bulk select / bulk PATCH** — API supports it, UI doesn't need it for daily triage
- **Companies and scrape-log views** — separate page, separate spec
- **Mobile responsive** — desktop tool; <1024px shows "open on desktop" gate
- **Test runner** — no Vitest setup. Manual verification per CLAUDE.md guidance is the contract for this spec

## Manual Verification

Before claiming complete:

- Load dashboard, verify each filter independently and in combination
- Sort by each sortable column, both directions
- Every key listed in §Keyboard Navigation, both modes
- Optimistic PATCH + revert (simulate by temporarily breaking the API)
- Detail panel for both AI-scored and keyword-only jobs
- `npm run build` and `npm run lint` both clean
- Smoke test in Safari and Chrome (grid+sticky edge cases)
- End-to-end: open `/`, change statuses, edit notes, confirm DB updates via the `.query.mjs` helper

Will NOT claim "tests pass" — there are none. Will report "manual verification ran" with the checklist above.
