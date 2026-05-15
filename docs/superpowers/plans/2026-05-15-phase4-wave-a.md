# Phase 4 Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three HTML/RSS-based job source scrapers (BuiltInNYC, We Work Remotely, Whitney) that surface jobs from companies the user doesn't watch individually. Establish the `custom_scraper` dispatch infrastructure so future scrapers can be added by following a pattern.

**Architecture:** Each source gets a parser in `src/lib/scrapers/custom/{slug}.ts` returning the existing `ScrapeResult` shape. A new `custom_scraper` text column on `watched_companies` selects which parser handles which row. The pipeline's existing `case "custom"` switch consults a registry. The three new sources are seeded as pseudo-companies in `watched_companies` and participate in the daily cron alongside Greenhouse/Lever/Ashby. Every parser does a sanity check before extraction and returns structured `parser_assumption_failed: ...` errors on schema drift.

**Tech Stack:** Next.js 16, Drizzle ORM, cheerio (already installed). RSS parsing reuses cheerio in xmlMode — no new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-15-phase4-design.md`](../specs/2026-05-15-phase4-design.md) — Features 1 and 2, scoped down per the deferred-sources decision below.

**Testing model:** No test runner. Per CLAUDE.md, every task ends with a **manual verification** step (DB query, curl, or live scrape run). A final task runs an end-to-end production-equivalent verification.

**Commit convention:** No `Co-Authored-By: Claude` trailer (matches existing repo history — verified across the dashboard and settings work). Plain `git commit -m "subject"` only. One commit per task.

**Branch:** `phase4-wave-a` (already created off `main` at SHA `222a23c`). Spec commit `3752b74` is the parent for Task 1.

**Dev server:** Likely already running on port 3001. If not: `. /tmp/job-agent-env.sh && npm run dev`. Check `/tmp/job-agent-dev.log` for "Ready in".

**Pre-existing lint warnings:** 3 in `src/lib/scrapers/{ashby,greenhouse,lever}.ts` (unused `ScrapedJob` imports). Predates this work. Do NOT fix; treat any new warning beyond those 3 as a task failure.

---

## Deferred from this plan

During plan-writing, the controller probed all 6 sources from the spec (BuiltInNYC, NYFA, WWR, MoMA, Whitney, New Museum) and found:

- **NYFA**: `/jobs/` is a client-rendered SPA — cheerio sees zero job content. WP REST endpoints are 403'd.
- **MoMA**: anti-scraping in place — 403 even with a Chrome User-Agent.
- **New Museum**: every careers URL we tried (`/jobs`, `/careers`, `/employment`, `/about/job-postings`, etc.) 404s.

These three are **out of scope for Wave A**. They require either a headless browser (Playwright) or human research that wasn't in the time budget. The pattern this plan establishes (per-source parser + sanity check + registry dispatch) extends straightforwardly to them later.

**Wave A ships 3 sources, not 6:**
- BuiltInNYC — HTML, parseable
- We Work Remotely — RSS feed at the same URL (content-negotiated)
- Whitney — HTML, parseable

---

## File Structure

**New files (9):**

- `src/lib/scrapers/custom/index.ts` — registry mapping `custom_scraper` slug → parser function
- `src/lib/scrapers/custom/builtinnyc.ts` — BuiltInNYC HTML scraper
- `src/lib/scrapers/custom/weworkremotely.ts` — We Work Remotely RSS scraper
- `src/lib/scrapers/custom/whitney.ts` — Whitney HTML scraper
- `src/lib/scrapers/custom/util.ts` — shared helpers (`fetchHtml`, `assertLandmark`, common error types)

**Modified files (5):**

- `src/lib/db/schema.ts` — add `customScraper` text column to `watched_companies`
- `src/lib/scrapers/index.ts` — replace `case "custom"` stub with registry dispatch
- `src/lib/constants.ts` — extend `INITIAL_COMPANIES` with the 3 new pseudo-companies; extend `CompanyCategory` if needed (`museum` already exists for Sothebys; add `aggregator` category)
- `src/components/settings/CompanyPanel.tsx` — surface `customScraper` as a select when `ats === "custom"`
- `src/app/api/companies/route.ts` — POST/PATCH handlers map `custom_scraper` snake_case → camelCase

---

## Task 1: Schema — add `customScraper` column

**Files:**
- Modify: `src/lib/db/schema.ts` (insert in `watchedCompanies` definition after `boardUrl`)

- [ ] **Step 1: Read current schema for context**

Open `src/lib/db/schema.ts`. Find the `watchedCompanies` table definition. It currently has columns ending with `boardUrl`, `category`, `priority`, `lastScraped`, `lastError`, `isActive`. We're adding `customScraper` between `boardUrl` and `category`.

- [ ] **Step 2: Add the column**

In the `watchedCompanies` definition, find:

```ts
    boardUrl: text("board_url").notNull().unique(),
    category: text("category"),
```

Insert one line between them so the block becomes:

```ts
    boardUrl: text("board_url").notNull().unique(),
    customScraper: text("custom_scraper"),
    category: text("category"),
```

Nullable. Populated only for `ats='custom'` rows. Existing rows are unaffected.

- [ ] **Step 3: Push schema**

```bash
. /tmp/job-agent-env.sh && npm run db:push
```

Expected: drizzle-kit reports `[✓] Changes applied`. If it prompts about column renames, answer **N**.

- [ ] **Step 4: Verify column landed**

```bash
. /tmp/job-agent-env.sh && node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = ${"watched_companies"} AND column_name = ${"custom_scraper"}`.then(r => console.log(r));
'
```

Expected: one row, `column_name=custom_scraper`, `data_type=text`, `is_nullable=YES`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: empty / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "Add custom_scraper column to watched_companies"
```

---

## Task 2: Shared scraper utilities

**Files:**
- Create: `src/lib/scrapers/custom/util.ts`

These helpers are used by all three Wave A scrapers (and any future custom scrapers).

- [ ] **Step 1: Create util.ts**

```ts
import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";

/**
 * Fetch a URL and parse with cheerio. Throws on HTTP error.
 * Uses a real-browser User-Agent so we look like Chrome, not a scraper.
 * Polite 15s timeout.
 */
export async function fetchAndParse(url: string, opts: { xmlMode?: boolean } = {}): Promise<CheerioAPI> {
  const res = await fetch(url, {
    headers: {
      "Accept": opts.xmlMode ? "application/rss+xml, application/xml;q=0.9, */*;q=0.8" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new ScraperError(`http_${res.status}: ${url}`);
  }
  const body = await res.text();
  return cheerio.load(body, opts.xmlMode ? { xmlMode: true } : undefined);
}

/**
 * Throws if the expected DOM landmark is missing OR returns fewer than minCount elements.
 * Use as a sanity check before parsing — if this throws, the site changed structure
 * and the scraper should NOT silently return 0 jobs.
 */
export function assertLandmark($: CheerioAPI, selector: string, slug: string, minCount = 1): void {
  const found = $(selector).length;
  if (found < minCount) {
    throw new ScraperError(`parser_assumption_failed: ${slug} found ${found} ${selector} (expected >= ${minCount})`);
  }
}

/**
 * Custom error class so the per-source scraper can distinguish structural failures
 * from network failures from generic exceptions.
 */
export class ScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScraperError";
  }
}

/**
 * Truncate a description to avoid bloating the DB with massive HTML blobs.
 * Aggregator listings are usually snippets anyway; this is a guardrail.
 */
export function truncateDescription(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: empty / exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scrapers/custom/util.ts
git commit -m "Add shared custom-scraper utilities (fetchAndParse, assertLandmark)"
```

---

## Task 3: BuiltInNYC scraper

**Files:**
- Create: `src/lib/scrapers/custom/builtinnyc.ts`

**Real-HTML findings from inspection (2026-05-15):**
- URL: `https://www.builtinnyc.com/jobs`
- Job cards: `[data-id="job-card"]` — 19 cards on page 1
- Title: `[data-id="job-card-title"]` (text content)
- Company name: `[data-id="company-title"]` (text content)
- URL: second `<a>` within card has `href="/job/{slug}/{external_id}"`
- Location: NOT in a clean attribute; appears in the card's overall text near salary/level info. We'll extract by scanning text — see code.

- [ ] **Step 1: Create the scraper**

```ts
import type { ScrapedJob, ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "builtinnyc";
const BOARD_URL = "https://www.builtinnyc.com/jobs";

/**
 * Scrape BuiltInNYC's NYC jobs feed.
 *
 * Page yields ~19 cards. The actual employer per card is in [data-id="company-title"]
 * — that goes into job.company_display_name. The scraper sets job.company_name to "builtinnyc"
 * (the pseudo-company slug) so dashboard grouping by company_name works.
 *
 * external_id: the numeric job ID at the end of the apply URL path.
 * If the URL pattern changes, the sanity check below will catch it.
 */
export async function scrapeBuiltInNYC(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    assertLandmark($, "[data-id='job-card']", SLUG, 1);

    $("[data-id='job-card']").each((_, el) => {
      const card = $(el);
      const title = card.find("[data-id='job-card-title']").text().trim();
      const companyName = card.find("[data-id='company-title']").text().trim();
      // The job URL is the second <a> in the card — it points to /job/{slug}/{id}
      const links = card.find("a[href^='/job/']");
      const href = links.first().attr("href") ?? "";
      const idMatch = href.match(/\/job\/[^/]+\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : null;
      const sourceUrl = href ? `https://www.builtinnyc.com${href}` : "";

      // Location is harder — card text concatenates: "<company> <title> <postedDate> <workStyle> <location> <salary> <level>..."
      // Best heuristic: pick the substring matching "(City), (State|abbrev)" or "Remote"
      const cleanText = card.text().replace(/\s+/g, " ").trim();
      const locMatch = cleanText.match(/((?:New York|Brooklyn|Manhattan|Queens|Bronx|Staten Island)[,\s][A-Z]{2}|Remote|Hybrid|In-Office)/i);
      const location = locMatch ? locMatch[1] : "";

      if (!title || !externalId) return; // skip malformed

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "BuiltInNYC"
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(cleanText, 1000), // snippet only — no full body on the listing page
        location,
        salary_text: null, // could be extracted from cleanText but lossy; AI scoring runs on description anyway
        date_posted: null, // not exposed in a stable form on the listing page
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Manual smoke — script-only, doesn't touch DB**

Verify the scraper returns parsed jobs against the live site:

```bash
. /tmp/job-agent-env.sh && cat > .smoke-builtinnyc.mjs <<'EOF'
import { scrapeBuiltInNYC } from "./src/lib/scrapers/custom/builtinnyc.ts";

// Fake a minimal WatchedCompany row
const fake = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "BuiltInNYC",
  ats: "custom",
  boardUrl: "https://www.builtinnyc.com/jobs",
  customScraper: "builtinnyc",
  category: null,
  priority: 2,
  lastScraped: null,
  lastError: null,
  isActive: true,
};

const r = await scrapeBuiltInNYC(fake);
console.log("error:", r.error);
console.log("jobs:", r.jobs.length);
if (r.jobs.length > 0) {
  console.log("first job:");
  console.log("  external_id:", r.jobs[0].external_id);
  console.log("  title:", r.jobs[0].title);
  console.log("  company:", r.jobs[0].company_display_name);
  console.log("  location:", r.jobs[0].location);
  console.log("  source_url:", r.jobs[0].source_url);
}
EOF
npx tsx .smoke-builtinnyc.mjs
```

If `tsx` is unavailable, fallback: temporarily expose a debug route or just trust the next step (where the pipeline runs the scraper for real). If `tsx` is available (project uses Next.js, which depends on tsx via its toolchain — `npx tsx` usually resolves), proceed.

Expected: `error: null`, `jobs:` between 1 and 50, first job has a non-empty title and company.

Whichever way you verified, remove the `.smoke-builtinnyc.mjs` script (it's in `.gitignore` via `.*.mjs`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/scrapers/custom/builtinnyc.ts
git commit -m "Add BuiltInNYC scraper"
```

---

## Task 4: We Work Remotely scraper (RSS)

**Files:**
- Create: `src/lib/scrapers/custom/weworkremotely.ts`

**Real-feed findings from inspection (2026-05-15):**
- URL: `https://weworkremotely.com/categories/remote-programming-jobs`
- Content negotiation: with `Accept: application/rss+xml`, this URL returns **RSS** (25 items).
- Per item fields: `title` (often "Company: Job Title" format), `link`, `region`, `category`, `pubDate`, `description` (HTML).

- [ ] **Step 1: Create the scraper**

```ts
import type { ScrapedJob, ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "weworkremotely";
const FEED_URL = "https://weworkremotely.com/categories/remote-programming-jobs";

/**
 * Scrape We Work Remotely's RSS feed. Content negotiation: when we send
 * Accept: application/rss+xml, the URL returns RSS, not HTML.
 *
 * RSS items have:
 *   <title>Company: Job Title</title>  (or sometimes just Job Title — split on first ":")
 *   <link>https://weworkremotely.com/remote-jobs/{slug}</link>
 *   <region>Anywhere in the World / Europe / etc.</region>
 *   <category>Full-Stack Programming / Back-End / etc.</category>
 *   <pubDate>RFC 2822 date string</pubDate>
 *   <description>HTML body</description>
 *
 * external_id: the URL slug at the end of the link path.
 */
export async function scrapeWeWorkRemotely(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(FEED_URL, { xmlMode: true });
    assertLandmark($, "item", SLUG, 1);

    $("item").each((_, el) => {
      const item = $(el);
      const rawTitle = item.find("title").first().text().trim();
      const link = item.find("link").first().text().trim();
      const region = item.find("region").first().text().trim();
      const pubDate = item.find("pubDate").first().text().trim();
      const descHtml = item.find("description").first().text();

      // Title format "Company: Job Title" → split on first colon
      let companyName = "";
      let title = rawTitle;
      const colonIdx = rawTitle.indexOf(":");
      if (colonIdx > 0 && colonIdx < 50) {
        companyName = rawTitle.slice(0, colonIdx).trim();
        title = rawTitle.slice(colonIdx + 1).trim();
      }

      // external_id from URL slug
      const idMatch = link.match(/\/remote-jobs\/([^/?#]+)/);
      const externalId = idMatch ? idMatch[1] : null;
      if (!title || !externalId) return;

      // Strip HTML from description for storage
      const plainDesc = descHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: link,
        company_name: SLUG,
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(plainDesc, 4000),
        location: region || "Remote",
        salary_text: null, // not in RSS
        date_posted: pubDate ? new Date(pubDate).toISOString() : null,
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Manual smoke**

```bash
. /tmp/job-agent-env.sh && cat > .smoke-wwr.mjs <<'EOF'
import { scrapeWeWorkRemotely } from "./src/lib/scrapers/custom/weworkremotely.ts";
const fake = { id: "00000000-0000-0000-0000-000000000000", name: "We Work Remotely", ats: "custom", boardUrl: "https://weworkremotely.com/categories/remote-programming-jobs", customScraper: "weworkremotely", category: null, priority: 2, lastScraped: null, lastError: null, isActive: true };
const r = await scrapeWeWorkRemotely(fake);
console.log("error:", r.error, "jobs:", r.jobs.length);
if (r.jobs.length > 0) {
  const j = r.jobs[0];
  console.log("first:", { title: j.title, company: j.company_display_name, location: j.location, url: j.source_url.slice(0,60) });
}
EOF
npx tsx .smoke-wwr.mjs
```

Expected: `error: null`, 10–30 jobs, first job has a company name parsed from the title prefix.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scrapers/custom/weworkremotely.ts
git commit -m "Add We Work Remotely RSS scraper"
```

---

## Task 5: Whitney scraper

**Files:**
- Create: `src/lib/scrapers/custom/whitney.ts`

**Real-HTML findings from inspection (2026-05-15):**
- URL: `https://whitney.org/about/job-postings`
- Page contains an `<h2>` with text "Current Available Positions". Jobs are listed inside the same parent container as `<p class="large">` paragraphs.
- Each job is an `<a>` whose `href` starts with `https://whitneymuseumofamericanart.applytojob.com/apply/{id}/{slug}`.
- Inspection found ~17 jobs.
- **No location, no description, no salary** — just title + apply URL.

- [ ] **Step 1: Create the scraper**

```ts
import type { ScrapedJob, ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, ScraperError } from "./util";

const SLUG = "whitney";
const BOARD_URL = "https://whitney.org/about/job-postings";

/**
 * Scrape Whitney's careers page.
 *
 * Page structure: an <h2>"Current Available Positions" inside a div.component.editor-content.
 * Each job is a paragraph (<p class="large">) containing one <a> linking to
 * whitneymuseumofamericanart.applytojob.com/apply/{id}/{slug}.
 *
 * Whitney lists no location, description, or salary in the listing — just title + apply URL.
 * AI scoring works on title alone (less precise but acceptable for cultural institution roles
 * where the title is the strongest signal).
 *
 * external_id: the {id} segment in the apply URL.
 */
export async function scrapeWhitney(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    assertLandmark($, "a[href*='whitneymuseumofamericanart.applytojob.com/apply/']", SLUG, 1);

    $("a[href*='whitneymuseumofamericanart.applytojob.com/apply/']").each((_, el) => {
      const a = $(el);
      const href = a.attr("href") ?? "";
      const title = a.text().trim();

      // Parse {id} from /apply/{id}/{slug}
      const idMatch = href.match(/\/apply\/([^/]+)\/[^/]+/);
      const externalId = idMatch ? idMatch[1] : null;
      if (!title || !externalId) return;

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: href,
        company_name: SLUG,
        company_display_name: "Whitney Museum of American Art",
        title,
        description: "", // not available on listing page
        location: "New York, NY", // hard-coded — Whitney is in NYC; the apply page may have remote/hybrid info but we don't follow links
        salary_text: null,
        date_posted: null,
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Manual smoke**

```bash
. /tmp/job-agent-env.sh && cat > .smoke-whitney.mjs <<'EOF'
import { scrapeWhitney } from "./src/lib/scrapers/custom/whitney.ts";
const fake = { id: "00000000-0000-0000-0000-000000000000", name: "Whitney", ats: "custom", boardUrl: "https://whitney.org/about/job-postings", customScraper: "whitney", category: null, priority: 1, lastScraped: null, lastError: null, isActive: true };
const r = await scrapeWhitney(fake);
console.log("error:", r.error, "jobs:", r.jobs.length);
if (r.jobs.length > 0) console.log("titles:", r.jobs.map(j=>j.title).slice(0,5));
EOF
npx tsx .smoke-whitney.mjs
```

Expected: `error: null`, 5–25 jobs (Whitney has a fairly steady ~15 open positions). Titles look like "Creative Director", "Engineer", "Joan Tisch Teaching Fellow", etc.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scrapers/custom/whitney.ts
git commit -m "Add Whitney scraper"
```

---

## Task 6: Custom-scraper registry

**Files:**
- Create: `src/lib/scrapers/custom/index.ts`

- [ ] **Step 1: Create the registry**

```ts
import type { WatchedCompany } from "@/lib/db/schema";
import type { ScrapeResult } from "@/lib/types";
import { scrapeBuiltInNYC } from "./builtinnyc";
import { scrapeWeWorkRemotely } from "./weworkremotely";
import { scrapeWhitney } from "./whitney";

type CustomScraperFn = (c: WatchedCompany) => Promise<ScrapeResult>;

/**
 * Registry mapping watched_companies.custom_scraper slug → parser function.
 *
 * To add a new custom scraper:
 * 1. Create src/lib/scrapers/custom/{slug}.ts exporting a function with this signature.
 * 2. Import it here and add an entry to CUSTOM_SCRAPERS.
 * 3. Add a watched_companies row with ats='custom' and custom_scraper='{slug}'.
 *    Either via INITIAL_COMPANIES + reseed, or via the Settings UI.
 */
export const CUSTOM_SCRAPERS: Record<string, CustomScraperFn> = {
  builtinnyc: scrapeBuiltInNYC,
  weworkremotely: scrapeWeWorkRemotely,
  whitney: scrapeWhitney,
};

export function getCustomScraper(slug: string | null): CustomScraperFn | null {
  if (!slug) return null;
  return CUSTOM_SCRAPERS[slug] ?? null;
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scrapers/custom/index.ts
git commit -m "Add custom-scraper registry with three Wave A scrapers"
```

---

## Task 7: Wire registry into the scraper switch

**Files:**
- Modify: `src/lib/scrapers/index.ts`

- [ ] **Step 1: Read the current file**

Open `src/lib/scrapers/index.ts`. The relevant switch is in `scrapeCompany()`. Find the `case "custom"` line — it currently returns an error stub: `{ ...base, error: "Custom scraper not implemented for ${company.name}" }`.

- [ ] **Step 2: Replace with registry dispatch**

Replace the `case "custom":` block with:

```ts
    case "custom": {
      const fn = getCustomScraper(company.customScraper);
      if (!fn) {
        return { ...base, error: `Unknown custom_scraper '${company.customScraper ?? "(null)"}' for ${company.name}` };
      }
      return fn(company);
    }
```

Add the import at the top of the file:

```ts
import { getCustomScraper } from "./custom";
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scrapers/index.ts
git commit -m "Dispatch custom ATS via the scraper registry"
```

---

## Task 8: Update constants and seed the three pseudo-companies

**Files:**
- Modify: `src/lib/constants.ts` (extend `CompanyCategory` union with `aggregator`; extend `INITIAL_COMPANIES` array with 3 new rows; extend `CompanySeed` with `custom_scraper`)
- Modify: `src/app/api/seed/route.ts` (pass `customScraper` from CompanySeed to the insert)

- [ ] **Step 1: Extend CompanyCategory**

In `src/lib/constants.ts`, find the `CompanyCategory` type at the top of the file:

```ts
type CompanyCategory =
  | "art_world" | "design_forward" | "ai" | "studio"
  | "brand" | "tech" | "startup" | "museum" | "media";
```

Add `"aggregator"`:

```ts
type CompanyCategory =
  | "art_world" | "design_forward" | "ai" | "studio"
  | "brand" | "tech" | "startup" | "museum" | "media" | "aggregator";
```

- [ ] **Step 2: Extend CompanySeed**

Find `CompanySeed` interface:

```ts
export interface CompanySeed {
  name: string;
  ats: ATS;
  board_url: string;
  category: CompanyCategory;
  priority?: 1 | 2 | 3;
  is_active?: boolean;
}
```

Add `custom_scraper`:

```ts
export interface CompanySeed {
  name: string;
  ats: ATS;
  board_url: string;
  category: CompanyCategory;
  priority?: 1 | 2 | 3;
  is_active?: boolean;
  custom_scraper?: string;
}
```

- [ ] **Step 3: Add three pseudo-companies to INITIAL_COMPANIES**

At the very end of the `INITIAL_COMPANIES` array (after the existing Doji entry), add a new section:

```ts
  // Custom: aggregators and museums (Phase 4 Wave A)
  {
    name: "BuiltInNYC",
    ats: "custom",
    board_url: "https://www.builtinnyc.com/jobs",
    category: "aggregator",
    custom_scraper: "builtinnyc",
    priority: 2,
  },
  {
    name: "We Work Remotely",
    ats: "custom",
    board_url: "https://weworkremotely.com/categories/remote-programming-jobs",
    category: "aggregator",
    custom_scraper: "weworkremotely",
    priority: 2,
  },
  {
    name: "Whitney",
    ats: "custom",
    board_url: "https://whitney.org/about/job-postings",
    category: "museum",
    custom_scraper: "whitney",
    priority: 1,
  },
```

(Make sure these go inside the closing `];` of `INITIAL_COMPANIES`.)

- [ ] **Step 4: Update the seed route to pass `customScraper`**

In `src/app/api/seed/route.ts`, find the `INITIAL_COMPANIES.map(...)` block. It currently maps these fields:

```ts
    const rows = INITIAL_COMPANIES.map((c) => ({
      name: c.name,
      ats: c.ats,
      boardUrl: c.board_url,
      category: c.category,
      priority: c.priority || 2,
      isActive: c.is_active ?? true,
    }));
```

Change to:

```ts
    const rows = INITIAL_COMPANIES.map((c) => ({
      name: c.name,
      ats: c.ats,
      boardUrl: c.board_url,
      customScraper: c.custom_scraper ?? null,
      category: c.category,
      priority: c.priority || 2,
      isActive: c.is_active ?? true,
    }));
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Seed the new rows**

```bash
. /tmp/job-agent-env.sh
curl -s -X POST http://localhost:3001/api/seed -H "Authorization: Bearer $CRON_SECRET" -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 200, message includes the 3 new companies being seeded (existing companies use `onConflictDoNothing` so they're skipped).

- [ ] **Step 7: Verify in DB**

```bash
. /tmp/job-agent-env.sh && node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
sql`SELECT name, ats, custom_scraper, category, is_active FROM watched_companies WHERE ats = ${"custom"} ORDER BY name`.then(r => console.log(JSON.stringify(r, null, 2)));
'
```

Expected: three rows (`BuiltInNYC`, `We Work Remotely`, `Whitney`), all `ats=custom`, all with the correct `custom_scraper` slug, all `is_active=true`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/constants.ts src/app/api/seed/route.ts
git commit -m "Seed BuiltInNYC, We Work Remotely, Whitney as custom pseudo-companies"
```

---

## Task 9: Settings UI — expose `customScraper` in CompanyPanel

**Files:**
- Modify: `src/components/settings/CompanyPanel.tsx`
- Modify: `src/app/api/companies/route.ts` (POST + PATCH pass `customScraper`)

- [ ] **Step 1: Read CompanyPanel.tsx for context**

The current panel has a `FormState` shape and renders fields for name, ATS, board URL, category, priority, active. We need to add a `customScraper` field that's only visible when `ats === "custom"`.

The list of available scrapers comes from the registry. To avoid an import cycle (CompanyPanel is a "use client" component, and the registry imports server-only code), hard-code the list in CompanyPanel:

```ts
const CUSTOM_SCRAPER_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "builtinnyc", label: "BuiltInNYC" },
  { value: "weworkremotely", label: "We Work Remotely" },
  { value: "whitney", label: "Whitney" },
] as const;
```

When new custom scrapers are added in future PRs, this list gets one more entry — there's a comment in the registry pointing here.

- [ ] **Step 2: Extend FormState**

In `CompanyPanel.tsx`, find the `FormState` interface:

```ts
interface FormState {
  name: string;
  ats: string;
  boardUrl: string;
  category: string;
  priority: number;
  isActive: boolean;
}
```

Add `customScraper`:

```ts
interface FormState {
  name: string;
  ats: string;
  boardUrl: string;
  customScraper: string;
  category: string;
  priority: number;
  isActive: boolean;
}
```

- [ ] **Step 3: Initialize from company**

In the `useState<FormState>(() => (...))` initializer and the form-reset logic, add:

```ts
customScraper: company?.customScraper ?? "",
```

(matching the existing pattern for the other fields).

- [ ] **Step 4: Add the CUSTOM_SCRAPER_OPTIONS constant**

Near the top of the component file, alongside the existing `ATS_VALUES` and `CATEGORY_VALUES`:

```ts
const CUSTOM_SCRAPER_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "builtinnyc", label: "BuiltInNYC" },
  { value: "weworkremotely", label: "We Work Remotely" },
  { value: "whitney", label: "Whitney" },
] as const;
```

- [ ] **Step 5: Render the conditional field**

In the JSX, after the ATS `<Field label="ATS">` and before `<Field label="Board URL">`, insert:

```tsx
{form.ats === "custom" && (
  <Field label="Custom scraper">
    <select
      value={form.customScraper}
      onChange={e => setForm({ ...form, customScraper: e.target.value })}
      className="input"
    >
      {CUSTOM_SCRAPER_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </Field>
)}
```

- [ ] **Step 6: Send `customScraper` in POST and PATCH bodies**

Find the `handleSave` function. Currently the POST body has:

```ts
body: JSON.stringify({
  name: form.name,
  ats: form.ats,
  board_url: form.boardUrl,
  category: form.category,
  priority: form.priority,
}),
```

Change to:

```ts
body: JSON.stringify({
  name: form.name,
  ats: form.ats,
  board_url: form.boardUrl,
  custom_scraper: form.customScraper || null,
  category: form.category,
  priority: form.priority,
}),
```

And the PATCH body's `updates` object:

```ts
updates: {
  name: form.name,
  ats: form.ats,
  board_url: form.boardUrl,
  custom_scraper: form.customScraper || null,
  category: form.category,
  priority: form.priority,
  is_active: form.isActive,
},
```

- [ ] **Step 7: Update `/api/companies` route to accept the field**

In `src/app/api/companies/route.ts`:

The POST handler currently has:

```ts
const { name, ats, board_url, category, priority } = body;
```

Change to:

```ts
const { name, ats, board_url, custom_scraper, category, priority } = body;
```

And the insert:

```ts
const [company] = await db
  .insert(watchedCompanies)
  .values({
    name,
    ats,
    boardUrl: board_url,
    customScraper: custom_scraper ?? null,
    category: category || null,
    priority: priority || 2,
    isActive: true,
  })
  .returning();
```

The PATCH handler's `safeUpdates` block currently has:

```ts
if ("name" in updates) safeUpdates.name = updates.name;
if ("ats" in updates) safeUpdates.ats = updates.ats;
if ("board_url" in updates) safeUpdates.boardUrl = updates.board_url;
if ("category" in updates) safeUpdates.category = updates.category;
if ("priority" in updates) safeUpdates.priority = updates.priority;
if ("is_active" in updates) safeUpdates.isActive = updates.is_active;
```

Add one line:

```ts
if ("custom_scraper" in updates) safeUpdates.customScraper = updates.custom_scraper;
```

- [ ] **Step 8: TypeScript + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean (3 pre-existing scraper warnings only).

- [ ] **Step 9: Manual verify — round-trip a custom company via API**

```bash
. /tmp/job-agent-env.sh
# Create a fake test company with custom_scraper
curl -s -X POST http://localhost:3001/api/companies -H "Content-Type: application/json" -d '{"name":"TestCustom","ats":"custom","board_url":"https://example.com/test","custom_scraper":"builtinnyc","category":"aggregator","priority":3}' -w "\nHTTP %{http_code}\n"

# Verify
node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
sql`SELECT name, ats, custom_scraper FROM watched_companies WHERE name = ${"TestCustom"}`.then(r => console.log(JSON.stringify(r[0])));
'

# Cleanup — hard delete (not soft-delete via API)
node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
sql`DELETE FROM watched_companies WHERE name = ${"TestCustom"}`.then(()=>console.log("cleaned"));
'
```

Expected: HTTP 201, DB shows the test row with `custom_scraper=builtinnyc`, cleanup deletes it.

- [ ] **Step 10: Commit**

```bash
git add src/components/settings/CompanyPanel.tsx src/app/api/companies/route.ts
git commit -m "Surface custom_scraper field in CompanyPanel and /api/companies"
```

---

## Task 10: End-to-end manual sweep + production verification

This is the final task — no new files. Run the full pipeline against the live DB, verify the three new sources produce jobs (or fail loudly), check build/lint, ship.

- [ ] **Step 1: Run the pipeline**

```bash
. /tmp/job-agent-env.sh
echo "=== Running scrape pipeline ==="
time curl -s -X POST http://localhost:3001/api/scrape -w "\nHTTP %{http_code}\n" --max-time 180 | head -c 800
```

Expected: HTTP 200. Summary should show `total_companies_scraped: 19` (was 16, +3 new). Some non-zero `total_new_jobs`. Errors array may contain entries — those should ONLY be from companies that legitimately are erroring; the three new sources should not error.

- [ ] **Step 2: Verify each new source produced jobs**

```bash
. /tmp/job-agent-env.sh && node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  for (const src of ["builtinnyc", "weworkremotely", "whitney"]) {
    const r = await sql`SELECT count(*)::int AS n FROM jobs WHERE source = ${src}`;
    const ec = await sql`SELECT last_error FROM watched_companies WHERE custom_scraper = ${src}`;
    console.log(`${src}: ${r[0].n} jobs in DB · last_error: ${ec[0]?.last_error ?? "null"}`);
  }
})();
'
```

Expected:
- `builtinnyc`: 5–30 jobs, `last_error: null`
- `weworkremotely`: 5–30 jobs, `last_error: null`
- `whitney`: 5–25 jobs, `last_error: null`

If any source returns 0 jobs AND `last_error: null`, that's suspicious — the sanity check should have caught structural failure. Investigate before continuing.

If any source returns `last_error: parser_assumption_failed: ...`, that's the loud-failure path working as designed. The scraper needs its selectors updated against the current HTML. **Fix the scraper, don't paper over it.** Use `curl` to fetch the current page and check what changed. Rerun the pipeline.

- [ ] **Step 3: Spot-check a few jobs in the DB**

```bash
. /tmp/job-agent-env.sh && node -e '
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  for (const src of ["builtinnyc", "weworkremotely", "whitney"]) {
    const r = await sql`SELECT title, company_display_name, location, source_url FROM jobs WHERE source = ${src} LIMIT 2`;
    console.log(`\n${src}:`);
    for (const j of r) {
      console.log(`  ${j.title} @ ${j.company_display_name} · ${j.location} · ${j.source_url.slice(0,60)}`);
    }
  }
})();
'
```

Expected: titles look like real job titles, companies look real, locations are populated (BuiltInNYC + WWR) or "New York, NY" (Whitney), URLs look real.

- [ ] **Step 4: Check the Settings UI renders the new companies**

```bash
curl -s 'http://localhost:3001/settings?tab=companies' | grep -oE 'BuiltInNYC|We Work Remotely|Whitney' | sort -u
```

Expected: all three names appear.

- [ ] **Step 5: Build clean**

```bash
. /tmp/job-agent-env.sh && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully`. Route table shows the existing routes plus no new ones (Wave A is server-side only). No type errors.

- [ ] **Step 6: Lint clean**

```bash
npm run lint 2>&1 | tail -10
```

Expected: 3 pre-existing scraper warnings only. No new warnings.

- [ ] **Step 7: Verify in the dashboard**

```bash
curl -s 'http://localhost:3001/?status=new' -o /tmp/dash.html
grep -c 'builtinnyc\|weworkremotely\|whitney' /tmp/dash.html
```

Expected: > 0 (the dashboard renders the new source values somewhere — most likely in the company column data or job rows). Visually confirm in browser that jobs from new sources have `company_display_name` from the listing (e.g., "Stripe" not "builtinnyc") in the Company column.

- [ ] **Step 8: Final commit if anything changed**

```bash
git status
# If clean, skip the commit step.
# Otherwise:
git add -A
git commit -m "Polish from Wave A manual verification"
```

- [ ] **Step 9: Push and merge**

When ready (likely after your review):

```bash
git push -u origin phase4-wave-a
# After GitHub PR review or direct merge:
git checkout main
git merge --ff-only phase4-wave-a
git push origin main
git branch -d phase4-wave-a
git push origin --delete phase4-wave-a
```

---

## Self-Review

Running the writing-plans skill's checklist.

**1. Spec coverage:**

| Spec section (Wave A) | Plan task |
|---|---|
| Aggregator scrapers — BuiltInNYC | Task 3 |
| Aggregator scrapers — NYFA | **Deferred** (documented in "Deferred from this plan") |
| Aggregator scrapers — We Work Remotely | Task 4 |
| Museum scrapers — MoMA | **Deferred** (documented) |
| Museum scrapers — Whitney | Task 5 |
| Museum scrapers — New Museum | **Deferred** (documented) |
| Schema: `customScraper` column | Task 1 |
| Custom dispatch via registry | Tasks 6, 7 |
| Pseudo-companies in watched_companies | Task 8 |
| Settings UI surfaces `custom_scraper` | Task 9 |
| Loud failure on schema drift | `assertLandmark()` in Task 2, used by every parser |
| Structured `last_error` surfaced in Settings | Existing — no new work; Tasks 3–5 produce structured errors |
| Manual verification | Task 10 |

All Wave A spec sections covered, with three sources legitimately deferred and documented.

**2. Placeholder scan:** No "TBD", no "implement later", no "similar to Task N". Every step has actual code. Every command has expected output.

**3. Type consistency:**
- `ScraperError`, `fetchAndParse`, `assertLandmark`, `truncateDescription` are defined in Task 2 and used by Tasks 3–5. ✓
- `CUSTOM_SCRAPERS` registry shape (`Record<string, (c: WatchedCompany) => Promise<ScrapeResult>>`) is consistent between Task 6 and the callers in Task 7. ✓
- `getCustomScraper(slug: string | null)` returns `CustomScraperFn | null` — Task 7's caller handles `null` with a clear error message. ✓
- `customScraper` column name (camelCase in Drizzle, `custom_scraper` snake_case in DB and API bodies) consistent across Tasks 1, 8, 9. ✓
- `CompanySeed.custom_scraper` is optional (`?`) so existing entries don't need to be touched. ✓

**One thing to flag explicitly:** the `.smoke-*.mjs` scripts in Tasks 3–5 use `npx tsx` to run TypeScript files directly. If `tsx` isn't on the path, those steps can't run. Next.js 16 ships with tsx as a transitive dep but the binary may not be hoisted to `node_modules/.bin/`. If `npx tsx` says "tsx not found", the manual smoke is informational only — the Task 10 end-to-end run will catch any breakage, and that's the gating verification. Treat the per-source smokes as nice-to-have, not blocking. The implementer should not stall here if `tsx` isn't available.

Plan is ready.
