# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the warm-mono job-triage dashboard at `/` per `docs/superpowers/specs/2026-05-14-dashboard-design.md`.

**Architecture:** Server component (`page.tsx`) fetches active jobs from Neon via the existing Drizzle client, passes them to a single client component (`<Dashboard />`) that owns all state. Mutations use the existing `PATCH /api/jobs` with optimistic updates. Schema gains two columns so the AI scorer's `green_flags`/`red_flags` (already returned by Claude, currently discarded) can populate the detail panel.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4 (already installed), Drizzle ORM over `@neondatabase/serverless` (HTTP, not WebSocket). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-14-dashboard-design.md`](../specs/2026-05-14-dashboard-design.md)

**Testing model:** No test runner exists in this project (CLAUDE.md confirms). Per the spec, this plan does NOT add Vitest — every task ends with a **manual verification** step instead of a test. A final task runs a full end-to-end manual verification sweep against the spec's checklist.

**Commit convention:** No prefixes (matches existing repo history — `Move 7 companies to Ashby...`, `Lazy-initialize Neon db client...`). One commit per task. Co-authored trailer NOT used in this repo, per existing history.

**Dev server note:** A dev server may already be running on port 3001 from earlier work (port 3000 was occupied at startup). When manual-verification steps say "open the dashboard," use whichever port the running server is on — check `/tmp/job-agent-dev.log` if unsure.

---

## File Structure

Everything new lives under `src/components/dashboard/` (one component per file, small focused units). Shared formatting helpers in `src/lib/format.ts`. Existing files modified only where the spec requires:

**New:**
- `src/components/dashboard/Dashboard.tsx` — top-level client component, owns all state
- `src/components/dashboard/Topbar.tsx` — brand + last-scraped + refresh
- `src/components/dashboard/StatsBar.tsx` — five derived-count cells
- `src/components/dashboard/FilterBar.tsx` — status/tier chips, score, search, archived toggle
- `src/components/dashboard/JobTable.tsx` — grid table, owns row focus
- `src/components/dashboard/DetailPanel.tsx` — slide-over panel, owns PATCH for status + notes
- `src/components/dashboard/Toast.tsx` — bottom-left error toast
- `src/components/dashboard/types.ts` — shared `Filters`, `Sort`, `StatusValue` types used across components
- `src/components/dashboard/keyboard.ts` — `useKeyboardNav` hook
- `src/lib/format.ts` — `scoreDisplay`, `relativeDate`, `tierColor`
- `src/app/error.tsx` — themed error boundary

**Modified:**
- `src/app/page.tsx` — replace Next.js starter with server component that fetches and mounts `<Dashboard />`
- `src/app/layout.tsx` — set `<html data-theme="dark">`, replace placeholder metadata
- `src/app/globals.css` — replace with palette CSS variables
- `src/lib/db/schema.ts` — add `greenFlags`, `redFlags` columns to `jobs`
- `src/lib/scoring/ai-scorer.ts` — no code change needed (return type already includes the fields); verify
- `src/app/api/cron/scrape/route.ts` — persist `greenFlags`/`redFlags` in `runAIScoring`

---

## Task 1: Schema — add `greenFlags` and `redFlags` columns

**Files:**
- Modify: `src/lib/db/schema.ts` (insert after `aiScoredAt`)
- Modify: `src/app/api/cron/scrape/route.ts` (in `runAIScoring`, lines 194–199)

The AI scorer's response shape (`AIScoreResponse` in `src/lib/types.ts`) already declares `green_flags: string` and `red_flags: string`. The scorer parses them. They're just being dropped on the floor at persist time. We add columns, persist them, and call it.

- [ ] **Step 1: Add columns to schema**

In `src/lib/db/schema.ts`, replace this block (currently lines 37–41):

```ts
    // Scoring
    keywordScore: real("keyword_score"),
    aiScore: real("ai_score"),
    aiReasoning: text("ai_reasoning"),
    aiScoredAt: timestamp("ai_scored_at", { withTimezone: true }),
```

with:

```ts
    // Scoring
    keywordScore: real("keyword_score"),
    aiScore: real("ai_score"),
    aiReasoning: text("ai_reasoning"),
    aiGreenFlags: text("ai_green_flags"),
    aiRedFlags: text("ai_red_flags"),
    aiScoredAt: timestamp("ai_scored_at", { withTimezone: true }),
```

(Naming: `ai*Flags` rather than bare `greenFlags`/`redFlags` so it's obvious in the schema these belong to the AI-scoring group. The spec uses `greenFlags`/`redFlags` informally — this is the canonical name. The detail panel will read `job.aiGreenFlags` / `job.aiRedFlags`.)

- [ ] **Step 2: Persist the fields in the cron route**

In `src/app/api/cron/scrape/route.ts`, find `runAIScoring` and replace the `if (result) {...}` block (currently around lines 194–200):

```ts
    if (result) {
      updates.aiScore = result.score;
      updates.aiReasoning = result.reasoning;
      updates.tier = result.tier;
      updates.roleCategory = result.role_category;
      scored++;
    }
```

with:

```ts
    if (result) {
      updates.aiScore = result.score;
      updates.aiReasoning = result.reasoning;
      updates.aiGreenFlags = result.green_flags;
      updates.aiRedFlags = result.red_flags;
      updates.tier = result.tier;
      updates.roleCategory = result.role_category;
      scored++;
    }
```

- [ ] **Step 3: Push the schema to Neon**

The env loader from earlier work is at `/tmp/job-agent-env.sh`. If it's missing, regenerate with:

```bash
perl -ne 'next if /^\s*#|^\s*$/; chomp; my ($k,$v) = split /=/, $_, 2; print qq{export $k=}.quotemeta($v).qq{\n}' .env.local > /tmp/job-agent-env.sh
```

Then push:

```bash
. /tmp/job-agent-env.sh && npm run db:push
```

Expected: drizzle-kit reports `[✓] Changes applied`. If it asks about renaming an existing column, type **N** — these are new columns, not renames.

- [ ] **Step 4: Verify columns landed**

```bash
. /tmp/job-agent-env.sh && node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${"jobs"} AND column_name IN (${"ai_green_flags"}, ${"ai_red_flags"})`.then(r => console.log(r));
'
```

Expected output: two rows, `ai_green_flags` and `ai_red_flags`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exits 0 with no output. (This confirms the schema change didn't break any consumer of `Job`/`NewJob` inferred types.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/app/api/cron/scrape/route.ts
git commit -m "Add ai_green_flags and ai_red_flags columns and persist in scorer"
```

---

## Task 2: Palette — replace `globals.css` with the warm-mono CSS variables

**Files:**
- Modify: `src/app/globals.css` (full replacement)
- Modify: `src/app/layout.tsx` (set `data-theme="dark"` and metadata)

The current `globals.css` uses cool grays and falls back to system `prefers-color-scheme`. We replace with the warm palette under `:root[data-theme="dark"]` so light mode can be added later by adding a `[data-theme="light"]` block — no component changes required.

- [ ] **Step 1: Replace `globals.css`**

Overwrite `src/app/globals.css` with:

```css
@import "tailwindcss";

:root[data-theme="dark"] {
  --bg:           #0a0907;
  --bg-row:       #0a0907;
  --bg-row-hover: #100e0a;
  --bg-row-sel:   #16130e;
  --bg-hdr:       #0d0b08;
  --bg-panel:     #0d0b08;
  --bg-backdrop:  rgba(0, 0, 0, 0.3);

  --border:       #18150f;
  --border-strong: #2a261c;

  --text-pri:     #ece8df;
  --text-sec:     #837e72;
  --text-tert:    #5a564d;

  --accent:       #d4a64c;
  --accent-bg:    rgba(212, 166, 76, 0.14);

  --green:        #9ec49e;
  --green-bg:     rgba(158, 196, 158, 0.10);

  --danger:       #c47e7e;
  --danger-bg:    rgba(196, 126, 126, 0.10);
}

@theme inline {
  --color-bg: var(--bg);
  --color-text-pri: var(--text-pri);
  --color-text-sec: var(--text-sec);
  --color-accent: var(--accent);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

html, body {
  height: 100%;
}

body {
  background: var(--bg);
  color: var(--text-pri);
  font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: var(--accent-bg);
  color: var(--text-pri);
}
```

- [ ] **Step 2: Update `layout.tsx`**

Replace the contents of `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "job-agent",
  description: "Job triage dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Manual verify — page renders dark**

Open the dashboard in the browser (whichever port the dev server is on; check `/tmp/job-agent-dev.log` if unsure). The Next.js starter page should now have a warm dark background (`#0a0907`) instead of the cool gray/dark fallback. Text should be off-white (`#ece8df`).

This isn't the final dashboard — that's later tasks. Just confirm the palette is applied to whatever's currently rendering.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "Replace palette with warm mono + amber accent (dashboard theme)"
```

---

## Task 3: Format helpers

**Files:**
- Create: `src/lib/format.ts`

Tiny pure helpers used by multiple components. No deps.

- [ ] **Step 1: Create `src/lib/format.ts`**

```ts
import type { Job } from "@/lib/db/schema";

/**
 * Display rule: AI score if present, else keyword score.
 * Sort and the score column both consult this — keeps display and ordering aligned.
 */
export function scoreDisplay(job: Job): { value: number; source: "ai" | "keyword" } {
  if (job.aiScore != null) {
    return { value: Math.round(job.aiScore), source: "ai" };
  }
  return { value: Math.round(job.keywordScore ?? 0), source: "keyword" };
}

/**
 * Short relative date: "2d", "5h", "now". Returns "—" for null.
 */
export function relativeDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

/**
 * Tier number → CSS color variable name (returned as a CSS value).
 * T1 = accent, T2 = primary, T3 = secondary, else null tier = secondary.
 */
export function tierColor(tier: number | null): string {
  if (tier === 1) return "var(--accent)";
  if (tier === 2) return "var(--text-pri)";
  return "var(--text-sec)";
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/format.ts
git commit -m "Add format helpers: scoreDisplay, relativeDate, tierColor"
```

---

## Task 4: Shared types for dashboard components

**Files:**
- Create: `src/components/dashboard/types.ts`

Centralize the union types and shape types used across components so each component file can `import type { ... } from "./types"` without redeclaring.

- [ ] **Step 1: Create `src/components/dashboard/types.ts`**

```ts
import type { Job } from "@/lib/db/schema";

export type StatusValue = "new" | "interested" | "applied" | "interviewing" | "passed";

export const STATUS_VALUES: readonly StatusValue[] = [
  "new",
  "interested",
  "applied",
  "interviewing",
  "passed",
] as const;

export interface Filters {
  status: StatusValue | null;
  tier: 1 | 2 | 3 | null;
  minScore: number;
  search: string;
}

export type SortField = "score" | "title" | "company" | "date";

export interface Sort {
  field: SortField;
  dir: "asc" | "desc";
}

export const DEFAULT_FILTERS: Filters = {
  status: null,
  tier: null,
  minScore: 0,
  search: "",
};

export const DEFAULT_SORT: Sort = {
  field: "score",
  dir: "desc",
};

/**
 * Convenience: re-export Job so component files have one import for everything dashboard-shaped.
 */
export type { Job };
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/types.ts
git commit -m "Add shared dashboard types"
```

---

## Task 5: Server component — fetch jobs, mount `<Dashboard />`

**Files:**
- Modify: `src/app/page.tsx` (full replacement)
- Create: `src/components/dashboard/Dashboard.tsx` (skeleton — will be filled in over the next tasks)

This task wires up the data fetch and the shell. The shell renders an "empty" dashboard area so we can see SSR'd data even before child components exist.

- [ ] **Step 1: Create skeleton `Dashboard.tsx`**

```tsx
"use client";

import type { Job } from "@/lib/db/schema";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
}

export default function Dashboard({ initialJobs, lastScraped }: DashboardProps) {
  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-[color:var(--border)] px-4 py-2 text-[11px]">
        <span className="text-[color:var(--text-sec)]">job-agent</span>
        <span className="float-right text-[color:var(--text-sec)]">
          {lastScraped ? `Last scraped ${lastScraped}` : "Never scraped"}
        </span>
      </div>
      <div className="flex-1 p-4 text-[color:var(--text-sec)]">
        {initialJobs.length} jobs loaded (dashboard chrome coming in next tasks)
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

Overwrite with:

```tsx
import { db } from "@/lib/db";
import { jobs as jobsTable, watchedCompanies } from "@/lib/db/schema";
import { eq, desc, max } from "drizzle-orm";
import { relativeDate } from "@/lib/format";
import Dashboard from "@/components/dashboard/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Fetch active jobs, ordered server-side just so the SSR'd HTML is already
  // close to what the client will sort to (default sort is by score desc).
  // The client re-sorts via scoreDisplay() since that interleaves AI + keyword
  // by displayed value, but starting from a near-correct order avoids a flash.
  const [activeJobs, lastScrapeRow] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.isActive, true)).orderBy(desc(jobsTable.aiScore), desc(jobsTable.keywordScore)),
    db.select({ ts: max(watchedCompanies.lastScraped) }).from(watchedCompanies),
  ]);

  const lastScrapedTs = lastScrapeRow[0]?.ts ?? null;

  return (
    <Dashboard
      initialJobs={activeJobs}
      lastScraped={lastScrapedTs ? relativeDate(lastScrapedTs) + " ago" : null}
    />
  );
}
```

Note on `max`: drizzle-orm exports `max` for aggregates. If `npx tsc --noEmit` complains, the import path is `drizzle-orm`. If it still complains, fall back to:

```ts
const rows = await db.select({ ts: watchedCompanies.lastScraped }).from(watchedCompanies).orderBy(desc(watchedCompanies.lastScraped)).limit(1);
const lastScrapedTs = rows[0]?.ts ?? null;
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 4: Manual verify — page renders job count**

Reload the dashboard URL. You should see:

- Topbar: `job-agent` on the left, `Last scraped <Nh> ago` on the right
- Body: `326 jobs loaded (dashboard chrome coming in next tasks)` or similar count

If it errors, check the dev server log. Most likely cause: the `max` import — fall back to the limit-1 ordering trick noted above.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Replace starter page with server-fetched dashboard shell"
```

---

## Task 6: `<Topbar />` — brand, last scraped, refresh

**Files:**
- Create: `src/components/dashboard/Topbar.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx` (use the real Topbar)

- [ ] **Step 1: Create `Topbar.tsx`**

```tsx
"use client";

import { useState } from "react";

interface TopbarProps {
  lastScraped: string | null;
  onRefresh: () => Promise<void>;
}

export default function Topbar({ lastScraped, onRefresh }: TopbarProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="flex h-9 items-center justify-between border-b border-[color:var(--border)] px-4 text-[11px]">
      <span className="font-mono text-[color:var(--text-sec)]">job-agent</span>
      <div className="flex items-center gap-3">
        <span className="text-[color:var(--text-sec)]">
          {lastScraped ? `Last scraped ${lastScraped}` : "Never scraped"}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh jobs"
          className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)] disabled:opacity-40"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={refreshing ? "animate-spin" : ""}>
            <path d="M14 8a6 6 0 1 1-1.76-4.24" />
            <path d="M14 2.5V6h-3.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Use it in `Dashboard.tsx`**

Replace the whole `Dashboard.tsx` body with:

```tsx
"use client";

import { useState, useCallback } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
}

export default function Dashboard({ initialJobs, lastScraped }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  const handleRefresh = useCallback(async () => {
    const res = await fetch("/api/jobs?active=true&limit=2000");
    if (!res.ok) return; // Toast handling comes in Task 13
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <main className="flex-1 p-4 text-[color:var(--text-sec)]">
        {jobs.length} jobs loaded — chrome coming in next tasks
      </main>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Manual verify**

Reload the page. Click the refresh icon — the spin animation runs briefly, the body line should still say `326 jobs loaded` (or whatever the active count is). Open DevTools Network tab: clicking refresh should fire one `GET /api/jobs?active=true&limit=2000` that returns 200.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/Topbar.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Add Topbar with brand, last-scraped, manual refresh"
```

---

## Task 7: `<StatsBar />` — five derived-count cells

**Files:**
- Create: `src/components/dashboard/StatsBar.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx` (mount StatsBar)

Stats are derived from the **full** `jobs` array, not the filtered set (spec §State Model).

- [ ] **Step 1: Create `StatsBar.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay } from "@/lib/format";
import type { StatusValue, Filters } from "./types";

interface StatsBarProps {
  jobs: Job[];
  filters: Filters;
  onSetStatusFilter: (status: StatusValue | null) => void;
  boardErrorCount: number;
  boardErrorNames: string[];
  boardActiveCount: number;
}

export default function StatsBar({ jobs, filters, onSetStatusFilter, boardErrorCount, boardErrorNames, boardActiveCount }: StatsBarProps) {
  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    let active = 0;
    let newToday = 0;
    let high = 0, med = 0, low = 0;
    const pipeline: Record<StatusValue, number> = { new: 0, interested: 0, applied: 0, interviewing: 0, passed: 0 };

    for (const j of jobs) {
      if (j.isActive) active++;
      const scrapedTs = j.dateScraped ? new Date(j.dateScraped).getTime() : 0;
      if (scrapedTs >= todayMs && j.status === "new") newToday++;

      const s = scoreDisplay(j).value;
      if (s >= 70) high++;
      else if (s >= 40) med++;
      else low++;

      if (j.status && j.status in pipeline) pipeline[j.status as StatusValue]++;
    }

    return { active, newToday, high, med, low, pipeline };
  }, [jobs]);

  return (
    <div className="grid h-16 grid-cols-[1fr_1fr_1fr_1.4fr_1fr] divide-x divide-[color:var(--border)] border-b border-[color:var(--border)]">
      <Cell label="Active">
        <span className="font-mono text-[22px] tabular-nums text-[color:var(--text-pri)]">{stats.active}</span>
      </Cell>
      <Cell label="New today">
        <span className="font-mono text-[22px] tabular-nums text-[color:var(--text-pri)]">{stats.newToday}</span>
      </Cell>
      <Cell label="Score (hi / md / lo)">
        <span className="font-mono text-[14px] tabular-nums text-[color:var(--text-pri)]">
          {stats.high} <span className="text-[color:var(--text-sec)]">·</span> {stats.med} <span className="text-[color:var(--text-sec)]">·</span> {stats.low}
        </span>
      </Cell>
      <Cell label="Pipeline">
        <div className="flex items-baseline gap-2 text-[12px]">
          {(["new", "interested", "applied", "interviewing"] as const).map((s, i) => {
            const isActive = filters.status === s;
            const short = ["new", "int", "app", "itw"][i];
            return (
              <button
                key={s}
                onClick={() => onSetStatusFilter(isActive ? null : s)}
                className={isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-pri)] hover:text-[color:var(--accent)]"}
              >
                <span className="text-[color:var(--text-sec)]">{short}</span>{" "}
                <span className="font-mono tabular-nums">{stats.pipeline[s]}</span>
              </button>
            );
          })}
        </div>
      </Cell>
      <Cell label="Boards">
        <span className="text-[12px]" title={boardErrorNames.length ? `Errors: ${boardErrorNames.join(", ")}` : undefined}>
          <span className="font-mono tabular-nums text-[color:var(--text-pri)]">{boardActiveCount}</span>{" "}
          <span className="text-[color:var(--text-sec)]">active</span>
          {boardErrorCount > 0 && (
            <>
              {" · "}
              <span className="font-mono tabular-nums text-[color:var(--danger)]">{boardErrorCount}</span>{" "}
              <span className="text-[color:var(--text-sec)]">error</span>
            </>
          )}
        </span>
      </Cell>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center px-4">
      <div>{children}</div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Fetch board info in `page.tsx`**

The Boards cell needs counts. Add a second query in `page.tsx`. Modify the existing `Promise.all` to:

```ts
const [activeJobs, lastScrapeRow, allBoards] = await Promise.all([
  db.select().from(jobsTable).where(eq(jobsTable.isActive, true)).orderBy(desc(jobsTable.aiScore), desc(jobsTable.keywordScore)),
  db.select({ ts: max(watchedCompanies.lastScraped) }).from(watchedCompanies),
  db.select({
    name: watchedCompanies.name,
    isActive: watchedCompanies.isActive,
    lastError: watchedCompanies.lastError,
  }).from(watchedCompanies),
]);

const boardActiveCount = allBoards.filter(b => b.isActive).length;
const boardErrorNames = allBoards.filter(b => b.isActive && b.lastError).map(b => b.name);
```

Pass the new props to `Dashboard`:

```tsx
return (
  <Dashboard
    initialJobs={activeJobs}
    lastScraped={lastScrapedTs ? relativeDate(lastScrapedTs) + " ago" : null}
    boardActiveCount={boardActiveCount}
    boardErrorNames={boardErrorNames}
  />
);
```

- [ ] **Step 3: Add filters state + StatsBar to `Dashboard.tsx`**

Replace `Dashboard.tsx` body with:

```tsx
"use client";

import { useState, useCallback } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import { DEFAULT_FILTERS, type Filters, type StatusValue } from "./types";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const handleRefresh = useCallback(async () => {
    const res = await fetch("/api/jobs?active=true&limit=2000");
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, []);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <StatsBar
        jobs={jobs}
        filters={filters}
        onSetStatusFilter={setStatusFilter}
        boardActiveCount={boardActiveCount}
        boardErrorCount={boardErrorNames.length}
        boardErrorNames={boardErrorNames}
      />
      <main className="flex-1 p-4 text-[color:var(--text-sec)]">
        Filter status: {filters.status ?? "all"} · {jobs.length} jobs · table comes next
      </main>
    </div>
  );
}
```

- [ ] **Step 4: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both clean.

- [ ] **Step 5: Manual verify**

Reload. The stats bar should show:

- Active: 326 (or current count)
- New today: 0 (or whatever has happened today)
- Score: high/med/low triple
- Pipeline: `new N · int N · app N · itw N` — click `new` and the body line should change to `Filter status: new`; click again and it goes back to `all`. Active pipeline button turns amber.
- Boards: `15 active` (or current) with error count in red if any

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/StatsBar.tsx src/components/dashboard/Dashboard.tsx src/app/page.tsx
git commit -m "Add StatsBar with derived counts and pipeline click-to-filter"
```

---

## Task 8: `<FilterBar />` — status/tier chips, score, search, archived toggle

**Files:**
- Create: `src/components/dashboard/FilterBar.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx` (mount FilterBar, add showArchived state, expose searchRef)

- [ ] **Step 1: Create `FilterBar.tsx`**

```tsx
"use client";

import { forwardRef } from "react";
import type { Filters, StatusValue } from "./types";

interface FilterBarProps {
  filters: Filters;
  showArchived: boolean;
  onChange: (next: Filters) => void;
  onToggleArchived: (next: boolean) => void;
}

const STATUS_CHIPS: { value: StatusValue | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "new", label: "New" },
  { value: "interested", label: "Interested" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
];

const TIER_CHIPS: { value: 1 | 2 | 3 | null; label: string }[] = [
  { value: 1, label: "T1" },
  { value: 2, label: "T2" },
  { value: 3, label: "T3" },
];

const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar(
  { filters, showArchived, onChange, onToggleArchived },
  searchRef
) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-[color:var(--border)] px-4 text-[11px]">
      {/* Status chips */}
      <div className="flex items-center gap-3">
        {STATUS_CHIPS.map(c => {
          const isActive = filters.status === c.value;
          return (
            <button
              key={c.label}
              onClick={() => onChange({ ...filters, status: c.value })}
              className={
                "border-b py-1 transition-colors " +
                (isActive
                  ? "border-[color:var(--accent)] text-[color:var(--text-pri)]"
                  : "border-transparent text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-3 w-px bg-[color:var(--border)]" />

      {/* Tier chips */}
      <div className="flex items-center gap-2">
        {TIER_CHIPS.map(c => {
          const isActive = filters.tier === c.value;
          return (
            <button
              key={c.label}
              onClick={() => onChange({ ...filters, tier: isActive ? null : c.value })}
              className={
                "rounded px-1.5 py-0.5 font-mono text-[10px] " +
                (isActive
                  ? "bg-[color:var(--accent-bg)] text-[color:var(--accent)]"
                  : "text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-3 w-px bg-[color:var(--border)]" />

      {/* Min score */}
      <label className="flex items-center gap-1 text-[color:var(--text-sec)]">
        Min score
        <input
          type="number"
          min={0}
          max={100}
          value={filters.minScore}
          onChange={e => onChange({ ...filters, minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          className="w-12 border-b border-[color:var(--border)] bg-transparent px-1 font-mono text-[11px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
        />
      </label>

      {/* Search */}
      <input
        ref={searchRef}
        type="text"
        placeholder="Search title or company…"
        value={filters.search}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        className="flex-1 border-b border-[color:var(--border)] bg-transparent px-2 py-1 text-[12px] text-[color:var(--text-pri)] placeholder-[color:var(--text-tert)] focus:border-[color:var(--accent)] focus:outline-none"
      />

      {/* Archived toggle */}
      <label className="flex cursor-pointer items-center gap-1.5 text-[color:var(--text-sec)]">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={e => onToggleArchived(e.target.checked)}
          className="accent-[color:var(--accent)]"
        />
        Archived
      </label>
    </div>
  );
});

export default FilterBar;
```

- [ ] **Step 2: Wire into `Dashboard.tsx`**

Update `Dashboard.tsx`:

```tsx
"use client";

import { useState, useCallback, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
import { DEFAULT_FILTERS, type Filters, type StatusValue } from "./types";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleRefresh = useCallback(async () => {
    const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, [showArchived]);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <StatsBar
        jobs={jobs}
        filters={filters}
        onSetStatusFilter={setStatusFilter}
        boardActiveCount={boardActiveCount}
        boardErrorCount={boardErrorNames.length}
        boardErrorNames={boardErrorNames}
      />
      <FilterBar
        ref={searchRef}
        filters={filters}
        showArchived={showArchived}
        onChange={setFilters}
        onToggleArchived={setShowArchived}
      />
      <main className="flex-1 p-4 text-[color:var(--text-sec)] text-[11px]">
        Filters: {JSON.stringify({ ...filters, showArchived })} · {jobs.length} jobs · table comes next
      </main>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Manual verify**

Reload. The filter bar should be visible below the stats. Try:
- Click a status chip — debug line at bottom updates, chip gets amber underline
- Click a tier chip — same, gets amber background
- Type in min-score — debug line updates
- Type in search — debug line updates
- Toggle Archived checkbox — debug line shows `showArchived: true`. Click refresh — should re-fetch.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/FilterBar.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Add FilterBar with status/tier chips, score, search, archived toggle"
```

---

## Task 9: `<JobTable />` — the table

**Files:**
- Create: `src/components/dashboard/JobTable.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx`

The table is the centerpiece. Filtering, sorting, and the focus ring all live here. Selection state (the panel) is owned by Dashboard but JobTable raises `onSelect` / `onFocus` events.

- [ ] **Step 1: Create `JobTable.tsx`**

```tsx
"use client";

import { useMemo, useEffect, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay, relativeDate, tierColor } from "@/lib/format";
import type { Filters, Sort, SortField, StatusValue } from "./types";

interface JobTableProps {
  jobs: Job[];
  filters: Filters;
  showArchived: boolean;
  sort: Sort;
  onSortChange: (next: Sort) => void;
  focusedId: string | null;
  selectedId: string | null;
  onFocus: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Expose the filtered+sorted list to the parent so keyboard nav can act on it. */
  onVisibleChange: (ids: string[]) => void;
}

const STATUS_LABEL: Record<StatusValue, string> = {
  new: "new",
  interested: "int",
  applied: "app",
  interviewing: "itw",
  passed: "—",
};

export default function JobTable({
  jobs, filters, showArchived, sort, onSortChange,
  focusedId, selectedId, onFocus, onSelect, onVisibleChange,
}: JobTableProps) {
  const visible = useMemo(() => {
    const searchLower = filters.search.trim().toLowerCase();
    const filtered = jobs.filter(j => {
      if (!showArchived && !j.isActive) return false;
      if (filters.status && j.status !== filters.status) return false;
      if (filters.tier !== null && j.tier !== filters.tier) return false;
      if (filters.minScore > 0 && scoreDisplay(j).value < filters.minScore) return false;
      if (searchLower) {
        const hay = `${j.title} ${j.companyDisplayName ?? j.companyName ?? ""}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => cmp(a, b, sort));
    return sorted;
  }, [jobs, filters, showArchived, sort]);

  // Tell parent what's visible (for keyboard nav)
  useEffect(() => {
    onVisibleChange(visible.map(j => j.id));
  }, [visible, onVisibleChange]);

  // Auto-scroll focused row into view
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (!focusedId) return;
    const el = rowRefs.current.get(focusedId);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  if (visible.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[color:var(--text-sec)] text-[12px]">
        {jobs.length === 0
          ? "No jobs yet. Run /api/cron/scrape to populate."
          : "No matches · clear filters"}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid w-full sticky top-0 z-10 bg-[color:var(--bg-hdr)] border-b border-[color:var(--border)]"
           style={{ gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 50px 40px 80px 50px" }}>
        <HeaderCell label="Title" field="title" sort={sort} onSort={onSortChange} />
        <HeaderCell label="Company" field="company" sort={sort} onSort={onSortChange} />
        <HeaderCell label="Location" field={null} />
        <HeaderCell label="Score" field="score" sort={sort} onSort={onSortChange} align="right" />
        <HeaderCell label="T" field={null} align="right" />
        <HeaderCell label="Status" field={null} />
        <HeaderCell label="Date" field="date" sort={sort} onSort={onSortChange} align="right" />
      </div>

      <div>
        {visible.map(job => {
          const s = scoreDisplay(job);
          const isFocused = focusedId === job.id;
          const isSelected = selectedId === job.id;
          return (
            <div
              key={job.id}
              ref={el => { if (el) rowRefs.current.set(job.id, el); else rowRefs.current.delete(job.id); }}
              onMouseEnter={() => onFocus(job.id)}
              onClick={() => onSelect(job.id)}
              className={
                "grid h-7 cursor-pointer items-center border-b border-[color:var(--border)] text-[12px] " +
                (isSelected
                  ? "bg-[color:var(--bg-row-sel)]"
                  : isFocused
                    ? "bg-[color:var(--bg-row-hover)]"
                    : "hover:bg-[color:var(--bg-row-hover)]") +
                (job.isActive ? "" : " opacity-60") +
                (isFocused || isSelected ? " border-l-2 border-l-[color:var(--accent)]" : " border-l-2 border-l-transparent")
              }
              style={{ gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 50px 40px 80px 50px" }}
            >
              <div className="truncate px-2.5">{job.title}</div>
              <div className="truncate px-2.5 text-[color:var(--text-sec)]">{job.companyDisplayName ?? job.companyName}</div>
              <div className="truncate px-2.5 text-[color:var(--text-sec)]">{job.location || "—"}</div>
              <div className={"px-2.5 text-right font-mono text-[11px] tabular-nums " + (s.source === "ai" ? "text-[color:var(--text-pri)]" : "text-[color:var(--text-sec)]")}>
                {s.value}
              </div>
              <div className="px-2.5 text-right font-mono text-[11px] tabular-nums" style={{ color: tierColor(job.tier) }}>
                {job.tier ?? "—"}
              </div>
              <div className="px-2.5">
                <StatusPill status={job.status as StatusValue} />
              </div>
              <div className="px-2.5 text-right font-mono text-[11px] tabular-nums text-[color:var(--text-sec)]">
                {relativeDate(job.dateScraped)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeaderCell({ label, field, sort, onSort, align }: { label: string; field: SortField | null; sort?: Sort; onSort?: (s: Sort) => void; align?: "right" }) {
  const isActive = field !== null && sort?.field === field;
  const handleClick = () => {
    if (!field || !onSort) return;
    if (!sort) return;
    onSort({ field, dir: isActive ? (sort.dir === "asc" ? "desc" : "asc") : "desc" });
  };
  return (
    <div
      onClick={handleClick}
      className={
        "px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[color:var(--text-sec)] " +
        (align === "right" ? "text-right " : "") +
        (field ? "cursor-pointer hover:text-[color:var(--text-pri)] " : "")
      }
    >
      {label}
      {isActive && sort && (
        <span className="ml-1 text-[color:var(--accent)]">{sort.dir === "asc" ? "▴" : "▾"}</span>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: StatusValue }) {
  if (status === "passed") return <span className="text-[color:var(--text-sec)]">—</span>;
  const base = "inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-medium";
  const styles: Record<Exclude<StatusValue, "passed">, string> = {
    new: "bg-[color:var(--accent-bg)] text-[color:var(--accent)]",
    interested: "border border-[color:var(--border-strong)] text-[color:var(--text-pri)]",
    applied: "border border-[color:var(--border-strong)] text-[color:var(--text-sec)]",
    interviewing: "bg-[color:var(--accent)] text-[color:var(--bg)]",
  };
  return <span className={`${base} ${styles[status as Exclude<StatusValue, "passed">]}`}>{STATUS_LABEL[status]}</span>;
}

function cmp(a: Job, b: Job, sort: Sort): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  switch (sort.field) {
    case "score": {
      return (scoreDisplay(a).value - scoreDisplay(b).value) * dir;
    }
    case "title":
      return a.title.localeCompare(b.title) * dir;
    case "company":
      return (a.companyDisplayName ?? a.companyName ?? "").localeCompare(b.companyDisplayName ?? b.companyName ?? "") * dir;
    case "date": {
      const at = a.dateScraped ? new Date(a.dateScraped).getTime() : 0;
      const bt = b.dateScraped ? new Date(b.dateScraped).getTime() : 0;
      return (at - bt) * dir;
    }
  }
}
```

- [ ] **Step 2: Wire into `Dashboard.tsx`**

Replace the `<main>` content with the JobTable. Full new `Dashboard.tsx`:

```tsx
"use client";

import { useState, useCallback, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
import JobTable from "./JobTable";
import { DEFAULT_FILTERS, DEFAULT_SORT, type Filters, type Sort, type StatusValue } from "./types";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleRefresh = useCallback(async () => {
    const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, [showArchived]);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  const handleVisibleChange = useCallback((ids: string[]) => {
    visibleIdsRef.current = ids;
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[color:var(--bg)]">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <StatsBar
        jobs={jobs}
        filters={filters}
        onSetStatusFilter={setStatusFilter}
        boardActiveCount={boardActiveCount}
        boardErrorCount={boardErrorNames.length}
        boardErrorNames={boardErrorNames}
      />
      <FilterBar
        ref={searchRef}
        filters={filters}
        showArchived={showArchived}
        onChange={setFilters}
        onToggleArchived={setShowArchived}
      />
      <JobTable
        jobs={jobs}
        filters={filters}
        showArchived={showArchived}
        sort={sort}
        onSortChange={setSort}
        focusedId={focusedId}
        selectedId={selectedId}
        onFocus={setFocusedId}
        onSelect={setSelectedId}
        onVisibleChange={handleVisibleChange}
      />
    </div>
  );
}
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Manual verify**

Reload. The full table should render with the warm palette:
- Rows visible, mono numbers right-aligned, status pills colored per spec
- Click a column header (Title, Company, Score, Date) — sort indicator toggles
- Hover a row — it highlights; click it — it gets selected (bg slightly darker, amber left border). No panel yet — that's next task.
- Filters narrow the table: status chips, tier chips, min score, search
- Toggle Archived: rows at 60% opacity should appear

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/JobTable.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Add JobTable with filter, sort, status pills, focus/select rings"
```

---

## Task 10: `<DetailPanel />` — slide-over with PATCH

**Files:**
- Create: `src/components/dashboard/DetailPanel.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx` (mount panel, lift PATCH handlers)

- [ ] **Step 1: Create `DetailPanel.tsx`**

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay } from "@/lib/format";
import { STATUS_VALUES, type StatusValue } from "./types";

interface DetailPanelProps {
  job: Job;
  onClose: () => void;
  onUpdateStatus: (status: StatusValue) => void;
  onUpdateNotes: (notes: string) => void;
  notesTextareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function DetailPanel({ job, onClose, onUpdateStatus, onUpdateNotes, notesTextareaRef }: DetailPanelProps) {
  const score = scoreDisplay(job);
  const [notes, setNotes] = useState(job.notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internalNotesRef = useRef<HTMLTextAreaElement>(null);
  const taRef = notesTextareaRef ?? internalNotesRef;
  const [showDescription, setShowDescription] = useState(false);

  // Reset notes state when the job changes (j/k flipping)
  useEffect(() => {
    setNotes(job.notes ?? "");
    setSaveState("idle");
    setShowDescription(false);
  }, [job.id, job.notes]);

  const handleNotesChange = (next: string) => {
    setNotes(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    debounceRef.current = setTimeout(async () => {
      try {
        onUpdateNotes(next);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("failed");
      }
    }, 800);
  };

  const subtitleParts = [
    job.companyDisplayName ?? job.companyName,
    job.location,
    job.salaryText,
  ].filter(Boolean);

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-[color:var(--bg-backdrop)]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-30 flex h-screen flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-panel)] shadow-[-8px_0_20px_rgba(0,0,0,0.5)]"
        style={{ width: "min(640px, 50vw)" }}
        role="dialog"
        aria-label="Job details"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-medium text-[color:var(--text-pri)]">{job.title}</h2>
              {job.sourceUrl && (
                <a
                  href={job.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[color:var(--text-sec)] hover:text-[color:var(--accent)]"
                  aria-label="Open job posting in new tab"
                >
                  ↗
                </a>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-[color:var(--text-sec)]">{subtitleParts.join(" · ")}</div>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="font-mono text-[18px] tabular-nums text-[color:var(--text-pri)]">
                {score.value}
                <span className="text-[color:var(--text-sec)]">
                  {score.source === "ai" ? " / 100" : " (keyword)"}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
            >
              ×
            </button>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4 py-2">
          <select
            value={job.status}
            onChange={e => onUpdateStatus(e.target.value as StatusValue)}
            className="rounded border border-[color:var(--border-strong)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
          >
            {STATUS_VALUES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-[color:var(--text-tert)]">
            1 new · 2 int · 3 app · 4 itw · 5 pass
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {job.aiReasoning && (
            <section className="mb-4">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">Reasoning</div>
              <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text-pri)]">
                {job.aiReasoning}
              </div>
            </section>
          )}

          {job.aiGreenFlags && (
            <section className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--green-bg)] px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--green)]">Green flags</div>
              <div className="text-[11px] leading-relaxed text-[color:var(--text-pri)]">{job.aiGreenFlags}</div>
            </section>
          )}

          {job.aiRedFlags && (
            <section className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--danger-bg)] px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--danger)]">Red flags</div>
              <div className="text-[11px] leading-relaxed text-[color:var(--text-pri)]">{job.aiRedFlags}</div>
            </section>
          )}

          {job.description && (
            <section className="mb-4">
              <button
                onClick={() => setShowDescription(s => !s)}
                className="text-[11px] text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
              >
                Description {showDescription ? "▾" : "▸"}
              </button>
              {showDescription && (
                <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2 text-[12px] text-[color:var(--text-pri)]">
                  {job.description}
                </div>
              )}
            </section>
          )}

          <section>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">Notes</div>
            <textarea
              ref={taRef}
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              rows={6}
              className="w-full resize-y rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2 text-[12px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
            />
            <div className="mt-1 text-[10px] text-[color:var(--text-sec)]">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved"}
              {saveState === "failed" && <span className="text-[color:var(--danger)]">Save failed — retry</span>}
              {saveState === "idle" && " "}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Lift mutation handlers into `Dashboard.tsx`**

Update `Dashboard.tsx` to compute `selectedJob` and pass PATCH handlers:

```tsx
"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
import JobTable from "./JobTable";
import DetailPanel from "./DetailPanel";
import { DEFAULT_FILTERS, DEFAULT_SORT, type Filters, type Sort, type StatusValue } from "./types";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedId) ?? null, [jobs, selectedId]);

  const handleRefresh = useCallback(async () => {
    const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, [showArchived]);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  const handleVisibleChange = useCallback((ids: string[]) => {
    visibleIdsRef.current = ids;
  }, []);

  const patchJob = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const prev = jobs.find(j => j.id === id);
    // optimistic
    setJobs(curr => curr.map(j => j.id === id ? { ...j, ...mapApiToJob(updates) } : j));
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // revert
      if (prev) setJobs(curr => curr.map(j => j.id === id ? prev : j));
      // Toast handling comes in Task 13
      console.error("PATCH failed:", err);
    }
  }, [jobs]);

  const handleUpdateStatus = useCallback((status: StatusValue) => {
    if (!selectedId) return;
    patchJob(selectedId, { status });
  }, [selectedId, patchJob]);

  const handleUpdateNotes = useCallback((notes: string) => {
    if (!selectedId) return;
    patchJob(selectedId, { notes });
  }, [selectedId, patchJob]);

  return (
    <div className="flex h-screen flex-col bg-[color:var(--bg)]">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <StatsBar
        jobs={jobs}
        filters={filters}
        onSetStatusFilter={setStatusFilter}
        boardActiveCount={boardActiveCount}
        boardErrorCount={boardErrorNames.length}
        boardErrorNames={boardErrorNames}
      />
      <FilterBar
        ref={searchRef}
        filters={filters}
        showArchived={showArchived}
        onChange={setFilters}
        onToggleArchived={setShowArchived}
      />
      <JobTable
        jobs={jobs}
        filters={filters}
        showArchived={showArchived}
        sort={sort}
        onSortChange={setSort}
        focusedId={focusedId}
        selectedId={selectedId}
        onFocus={setFocusedId}
        onSelect={setSelectedId}
        onVisibleChange={handleVisibleChange}
      />
      {selectedJob && (
        <DetailPanel
          key={selectedJob.id}
          job={selectedJob}
          onClose={() => setSelectedId(null)}
          onUpdateStatus={handleUpdateStatus}
          onUpdateNotes={handleUpdateNotes}
          notesTextareaRef={notesRef}
        />
      )}
    </div>
  );
}

/** Map API snake_case keys back to camelCase Job columns for optimistic state. */
function mapApiToJob(updates: Record<string, unknown>): Partial<Job> {
  const out: Record<string, unknown> = {};
  if ("status" in updates) out.status = updates.status;
  if ("notes" in updates) out.notes = updates.notes;
  if ("applied_date" in updates) out.appliedDate = updates.applied_date ? new Date(updates.applied_date as string) : null;
  if ("is_active" in updates) out.isActive = updates.is_active;
  if ("tier" in updates) out.tier = updates.tier;
  if ("role_category" in updates) out.roleCategory = updates.role_category;
  return out as Partial<Job>;
}
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Manual verify**

Reload. Click a row — slide-over panel opens. Verify:
- Header has title, ↗ link, ×, score
- Subtitle has Company · Location · Salary if any (no `· null` artifacts)
- If AI-scored: reasoning + green flags (only if column has data, which for now means freshly scraped jobs after Task 1; older ones won't show flags yet) + red flags
- Description disclosure expands and collapses
- Change status dropdown — DevTools Network should show PATCH /api/jobs with `{ ids: [id], updates: { status: "..." } }` returning 200. Page should reflect immediately. Refresh — change persists.
- Type in notes — after 800ms idle, PATCH fires with `{ notes: "..." }`. "Saving…" → "Saved" → fades. Refresh — text persists.
- Click outside or × — panel closes.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DetailPanel.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Add DetailPanel slide-over with status dropdown and debounced notes"
```

---

## Task 11: Keyboard navigation hook

**Files:**
- Create: `src/components/dashboard/keyboard.ts`
- Modify: `src/components/dashboard/Dashboard.tsx`

Two modes, gated on `selectedId != null`. Bails when an `input` or `textarea` is focused (only `escape` still applies).

- [ ] **Step 1: Create `keyboard.ts`**

```ts
"use client";

import { useEffect, useRef } from "react";
import type { StatusValue } from "./types";

interface UseKeyboardNavArgs {
  visibleIds: () => string[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onChangeStatus: (status: StatusValue) => void;
  focusSearch: () => void;
}

const STATUS_BY_DIGIT: Record<string, StatusValue> = {
  "1": "new",
  "2": "interested",
  "3": "applied",
  "4": "interviewing",
  "5": "passed",
};

export function useKeyboardNav({
  visibleIds,
  focusedId,
  setFocusedId,
  selectedId,
  setSelectedId,
  onChangeStatus,
  focusSearch,
}: UseKeyboardNavArgs) {
  const lastKeyRef = useRef<string | null>(null);
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const isInText = tag === "INPUT" || tag === "TEXTAREA";

      // Escape works even in inputs (to blur)
      if (e.key === "Escape") {
        if (isInText) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (selectedId) {
          e.preventDefault();
          setSelectedId(null);
          return;
        }
        if (focusedId) {
          setFocusedId(null);
          return;
        }
        return;
      }

      // All other keys yield to text inputs
      if (isInText) return;

      const ids = visibleIds();
      const idx = focusedId ? ids.indexOf(focusedId) : -1;

      const panelOpen = selectedId !== null;

      if (e.key === "j") {
        e.preventDefault();
        if (ids.length === 0) return;
        const next = idx < 0 ? 0 : Math.min(idx + 1, ids.length - 1);
        setFocusedId(ids[next]);
        if (panelOpen) setSelectedId(ids[next]);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        if (ids.length === 0) return;
        const next = idx < 0 ? 0 : Math.max(idx - 1, 0);
        setFocusedId(ids[next]);
        if (panelOpen) setSelectedId(ids[next]);
        return;
      }
      if (e.key === "Enter") {
        if (!panelOpen && focusedId) {
          e.preventDefault();
          setSelectedId(focusedId);
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === "G" && e.shiftKey) {
        e.preventDefault();
        if (ids.length > 0) {
          const last = ids[ids.length - 1];
          setFocusedId(last);
          if (panelOpen) setSelectedId(last);
        }
        return;
      }
      if (e.key === "g") {
        const now = Date.now();
        if (lastKeyRef.current === "g" && now - lastKeyTimeRef.current < 500) {
          e.preventDefault();
          if (ids.length > 0) {
            setFocusedId(ids[0]);
            if (panelOpen) setSelectedId(ids[0]);
          }
          lastKeyRef.current = null;
        } else {
          lastKeyRef.current = "g";
          lastKeyTimeRef.current = now;
        }
        return;
      }
      lastKeyRef.current = e.key;
      lastKeyTimeRef.current = Date.now();

      // Panel-mode digit shortcuts
      if (panelOpen && STATUS_BY_DIGIT[e.key]) {
        e.preventDefault();
        onChangeStatus(STATUS_BY_DIGIT[e.key]);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, setFocusedId, selectedId, setSelectedId, onChangeStatus, focusSearch, visibleIds]);
}
```

- [ ] **Step 2: Wire into `Dashboard.tsx`**

Add the import and the hook call. After `notesRef`, add:

```tsx
import { useKeyboardNav } from "./keyboard";

// ...inside the component, after handleUpdateNotes:
useKeyboardNav({
  visibleIds: useCallback(() => visibleIdsRef.current, []),
  focusedId,
  setFocusedId,
  selectedId,
  setSelectedId,
  onChangeStatus: handleUpdateStatus,
  focusSearch: useCallback(() => searchRef.current?.focus(), []),
});
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Manual verify**

Reload. With the page focused (click anywhere outside an input first):

| Key | Expected behavior |
|---|---|
| `j` | Focus moves down a row, scrolls if needed |
| `k` | Focus moves up a row |
| `Enter` | Panel opens for the focused row |
| `j` / `k` (panel open) | Selection AND focus move, panel updates |
| `Escape` | Closes panel; second press clears row focus |
| `/` | Search input gets focus |
| `g g` (within ~500ms) | Jump to first row |
| `Shift+G` | Jump to last row |
| `1`–`5` (panel open) | Status changes; verify via DevTools and a refresh |
| Type in notes textarea | `j`/`k` don't move selection — they type letters into notes |

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/keyboard.ts src/components/dashboard/Dashboard.tsx
git commit -m "Add keyboard navigation: j/k/enter/escape, gg/G, /, 1-5 status"
```

---

## Task 12: Narrow-viewport gate

**Files:**
- Modify: `src/app/page.tsx` (or new `src/app/_too-narrow.tsx`)

Spec calls for an "Open on desktop" message under 1024px. Simplest implementation: a CSS-only block in `globals.css` using `@media (max-width: 1023px)` to hide `<main>` and show a centered message.

- [ ] **Step 1: Add the CSS gate to `globals.css`**

Append to `src/app/globals.css`:

```css
.too-narrow {
  display: none;
}

@media (max-width: 1023px) {
  .dashboard-root { display: none !important; }
  .too-narrow {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
    text-align: center;
    color: var(--text-sec);
    font-size: 13px;
  }
}
```

- [ ] **Step 2: Wrap the dashboard in `Dashboard.tsx`**

In `Dashboard.tsx`, change the root `<div className="flex h-screen flex-col bg-[color:var(--bg)]">` to add the gate class, and add the narrow-viewport message as a sibling. Change the existing wrapper:

```tsx
return (
  <>
    <div className="dashboard-root flex h-screen flex-col bg-[color:var(--bg)]">
      {/* existing Topbar/StatsBar/FilterBar/JobTable/DetailPanel */}
    </div>
    <div className="too-narrow">
      <div>
        <div className="mb-1 font-mono text-[color:var(--text-pri)]">job-agent</div>
        <div>Open on desktop · ≥1024px</div>
      </div>
    </div>
  </>
);
```

- [ ] **Step 3: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Manual verify**

Reload at normal width — dashboard renders. Open DevTools, set responsive viewport to 1023px — only the "Open on desktop" message shows. Bump to 1024+ — dashboard renders.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/components/dashboard/Dashboard.tsx
git commit -m "Add narrow-viewport gate at <1024px"
```

---

## Task 13: Error toast + themed error page

**Files:**
- Create: `src/components/dashboard/Toast.tsx`
- Create: `src/app/error.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx` (mount Toast, surface PATCH/refresh failures)

- [ ] **Step 1: Create `Toast.tsx`**

```tsx
"use client";

interface ToastProps {
  message: string | null;
  onRetry?: () => void;
  onDismiss: () => void;
}

export default function Toast({ message, onRetry, onDismiss }: ToastProps) {
  if (!message) return null;
  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-3 rounded border border-[color:var(--border-strong)] bg-[color:var(--bg-panel)] px-3 py-2 text-[11px] text-[color:var(--text-pri)] shadow-lg">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-[color:var(--accent)] hover:underline">
          Retry
        </button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]">
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/error.tsx`**

```tsx
"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[color:var(--bg)] text-[color:var(--text-pri)]">
      <div className="text-center">
        <div className="mb-2 font-mono text-[color:var(--text-sec)]">job-agent</div>
        <div className="mb-4">Couldn&rsquo;t load jobs</div>
        <button
          onClick={reset}
          className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-[12px] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire toast into `Dashboard.tsx`**

Add toast state and surface PATCH/refresh failures. In `Dashboard.tsx`:

Add at top of state block:
```tsx
const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);
```

Update `handleRefresh` to set toast on failure:
```tsx
const handleRefresh = useCallback(async () => {
  try {
    const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  } catch {
    setToast({ message: "Refresh failed", retry: () => void handleRefresh() });
  }
}, [showArchived]);
```

Update `patchJob` to set toast on failure (replace the `console.error` line):
```tsx
} catch (err) {
  if (prev) setJobs(curr => curr.map(j => j.id === id ? prev : j));
  setToast({
    message: "Couldn’t update job",
    retry: () => void patchJob(id, updates),
  });
}
```

Mount `<Toast />` at the end of the JSX (just before the closing `</div>` of `dashboard-root`):
```tsx
<Toast
  message={toast?.message ?? null}
  onRetry={toast?.retry}
  onDismiss={() => setToast(null)}
/>
```

And add the import:
```tsx
import Toast from "./Toast";
```

- [ ] **Step 4: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Manual verify — simulate a failure**

Temporarily break the PATCH endpoint to test the failure path. In a separate terminal:

```bash
# In src/app/api/jobs/route.ts, temporarily add at the top of PATCH:
#   return NextResponse.json({ error: "test" }, { status: 500 });
```

Reload, open a row, change status. The status should optimistically change, then **revert** when the PATCH fails, and a toast should appear bottom-left with `Couldn't update job · Retry · ×`. Click Retry — PATCH fires again, fails again, same toast. Click × — toast disappears.

**Important:** undo the temporary 500 in `src/app/api/jobs/route.ts` before committing. Re-test that status changes now persist.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/Toast.tsx src/app/error.tsx src/components/dashboard/Dashboard.tsx
git commit -m "Add error toast and themed error page"
```

---

## Task 14: Cleanup, build, lint, full manual sweep

**Files:** none — pure verification.

- [ ] **Step 1: Strip the dev-server background process**

If the dev server has been running since earlier work, leave it. If you started it for this plan, stop it (TaskStop or Ctrl-C the npm run dev).

- [ ] **Step 2: Build clean**

```bash
. /tmp/job-agent-env.sh && npm run build
```

Expected: `✓ Compiled successfully` and route `○ /` is now Dynamic (it does a DB fetch in the server component). No type errors, no lint warnings.

- [ ] **Step 3: Lint clean**

```bash
npm run lint
```

Expected: exits 0, no warnings.

- [ ] **Step 4: Manual verification sweep**

Open the dashboard. Check each item from the spec's "Manual Verification" section against actual behavior:

- [ ] Each filter independently and in combination (status, tier, score, search, archived toggle)
- [ ] Sort by each sortable column (title, company, score, date), both directions
- [ ] All keyboard shortcuts in table mode: `j`, `k`, `Enter`, `/`, `gg`, `Shift+G`, `Escape`
- [ ] All keyboard shortcuts in panel mode: `j` and `k` flip selection, `Escape` closes, `1`–`5` change status
- [ ] Notes textarea: j/k yield to typing; debounce save fires; "Saving" → "Saved" feedback
- [ ] Optimistic PATCH + revert (already tested in Task 13 with the temporary 500)
- [ ] Detail panel renders correctly for an AI-scored job AND a keyword-only job (find one in the list — its score should be dim)
- [ ] Empty-state messages: filter to zero results, confirm `No matches · clear filters`
- [ ] Pipeline buttons in StatsBar toggle the status filter
- [ ] Refresh icon spins and re-fetches
- [ ] Last-scraped timestamp matches reality
- [ ] Boards count + error tooltip works (hover the cell)
- [ ] Visual check: row at 60% opacity when `is_active=false` (toggle Archived to see them)

- [ ] **Step 5: Cross-browser**

Open the dashboard in **Safari** as well as Chrome. Specifically check:
- The slide-over animation runs smoothly (Safari sometimes janks on transform transitions)
- Sticky table header stays put while scrolling
- The grid columns don't blow out on long titles (`min-width: 0` already on cells)

- [ ] **Step 6: Push the spec is satisfied**

If anything from the spec checklist doesn't behave as described, fix it now before the final commit — small inline fixes are better than reopening the plan.

- [ ] **Step 7: Final commit if anything changed; push everything**

```bash
git status
# If clean, skip the commit step
# If anything changed:
git add -A
git commit -m "Polish from manual verification sweep"

# Push the whole branch
git push origin main
```

---

## Self-Review (writer's check)

I'm checking this plan against the spec one more time before handing off.

**1. Spec coverage:**

| Spec section | Plan task |
|---|---|
| Architecture (server component + client tree) | Task 5 |
| State Model (useState fields, derived values, scoreDisplay) | Tasks 7, 9, 10 |
| Optimistic PATCH | Task 10 |
| Palette CSS variables | Task 2 |
| Topbar | Task 6 |
| StatsBar (5 cells, derived counts) | Task 7 |
| FilterBar (chips, score, search, archived) | Task 8 |
| JobTable (grid, sortable headers, status pills, focus/select rings) | Task 9 |
| DetailPanel (slide-over with header, status row, AI section, description, notes) | Task 10 |
| Keyboard nav (j/k/enter/escape/gg/G// , 1–5 in panel) | Task 11 |
| Schema additions (greenFlags, redFlags) | Task 1 |
| Error handling (themed error page, toast, retry) | Task 13 |
| Empty states (no jobs, no matches) | Task 9 (in JobTable) |
| Narrow-viewport gate | Task 12 |
| Out-of-scope (light mode, pagination, bulk, mobile, tests) | Honored — none included |
| Manual verification checklist | Task 14 |

All sections covered.

**2. Placeholder scan:** No "TBD" / "TODO" / "add error handling" left in the plan. Every code step has actual code. Every command has expected output.

**3. Type consistency:**
- `StatusValue` defined once in `types.ts`, imported by StatsBar, FilterBar, JobTable, DetailPanel, keyboard.ts. ✓
- `Filters`, `Sort`, `SortField` same. ✓
- `scoreDisplay` return shape `{ value, source: "ai" | "keyword" }` is consistent across uses. ✓
- `Job` import path `@/lib/db/schema` consistent. ✓
- Schema columns `aiGreenFlags` / `aiRedFlags` are used consistently in DetailPanel and the cron route. ✓ (Note: I named these with the `ai` prefix in the schema even though the spec said `greenFlags`/`redFlags` — flagged in Task 1.)
- `STATUS_VALUES` is defined in `types.ts` and used in DetailPanel. ✓

One thing the plan deliberately differs from the spec on, which I want to flag: **the column names became `aiGreenFlags` / `aiRedFlags`** instead of `greenFlags`/`redFlags`. Reason: they sit in the "Scoring" group of the schema (alongside `aiScore`, `aiReasoning`, `aiScoredAt`) and the naming is consistent with that group. The DB columns are `ai_green_flags` / `ai_red_flags`. This is a small naming improvement, not a spec deviation in spirit — but flagging it explicitly.

Plan is ready.
