# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (`eslint-config-next`, flat config in `eslint.config.mjs`) |
| `npm run db:push` | Push Drizzle schema to Neon (no migrations needed) |
| `npm run db:generate` | Generate migration files from schema |
| `npm run db:studio` | Open Drizzle Studio against `DATABASE_URL` |

### Triggering the pipeline locally

Both cron-style endpoints are gated by `Bearer ${CRON_SECRET}`:

```bash
# Seed initial companies (idempotent — onConflictDoNothing on board_url)
curl -X POST http://localhost:3000/api/seed -H "Authorization: Bearer $CRON_SECRET"

# Run the full scrape + score pipeline
curl http://localhost:3000/api/cron/scrape -H "Authorization: Bearer $CRON_SECRET"
```

In production, `.github/workflows/daily-scrape.yml` hits `SCRAPE_URL` (the Vercel-hosted `/api/cron/scrape`) daily at 12:05 UTC with the same bearer. Vercel itself does **not** run the cron — GitHub Actions does — so `vercel.json` only sets `maxDuration: 60` for that route.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Neon connection string (`postgresql://...?sslmode=require`) |
| `CRON_SECRET` | Yes | Bearer token for scrape/seed endpoints. Generate with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | No | AI scoring skips gracefully without it. Keyword scoring still runs. |
| `RESEND_API_KEY` | No | Phase 2 — daily digest email |
| `NOTIFICATION_EMAIL` | No | Phase 2 — digest recipient |

## Architecture

This is a single-user job-search agent. There is no auth, no multi-tenancy. The dashboard at `/` and the configuration UI at `/settings` are both shipped. The daily pipeline runs on Vercel via GitHub Actions.

### The pipeline — split into two phases

Vercel Hobby's 60s function limit can't fit scraping 20+ sources AND running AI scoring in one invocation. The pipeline is split:

**Phase 1 — `runScrapePipeline()` in `src/lib/pipeline/scrape.ts`:**

1. Load active rows from `watched_companies`.
2. `scrapeAll()` — fans out to `scrapeCompany()` in batches of 5 (`CONCURRENCY` in `src/lib/scrapers/index.ts`). Each company is routed by `ats` (`greenhouse` | `lever` | `ashby` | `custom`).
3. For every scraped job: dedupe against `(external_id, source)` unique index, run `scoreKeywords()`, apply hard filters, insert. Below-threshold jobs (`SCORE_THRESHOLD_ARCHIVE = 20`) or hard-filter failures land with `status: "passed"` and `is_active: false`.
4. Each per-company result is written to `scrape_log`; `watched_companies.last_scraped` / `last_error` are updated regardless of outcome.

Routes: `GET /api/cron/scrape` (Bearer-gated, GH Actions), `POST /api/scrape` (open, UI). Returns `ai_scores_run: 0` since Phase 2 is now separate.

**Phase 2 — `runScoringPass(limit)` in `src/lib/pipeline/scrape.ts`:**

1. Pick top `limit` unscored jobs with `keyword_score >= SCORE_THRESHOLD_AI`, ordered by keyword score desc. Production limit is 10 per call (set in the route handlers); the `AI_SCORING_MAX_PER_RUN = 30` constant is the default if no limit is passed.
2. Call Claude for each. Sleeps 500ms between calls as the rate limit.
3. **Every candidate gets `ai_scored_at` stamped even on failure** — intentional to prevent retrying broken jobs forever. To re-score (e.g. after prompt changes): `UPDATE jobs SET ai_scored_at = NULL, ai_score = NULL, ai_reasoning = NULL;`.
4. At the end of the pass, fires `maybeRunDigest()` — the email digest sends today's scored jobs if user prefs match. Digest failures are logged but don't fail the run.

Routes: `GET /api/cron/score` (Bearer-gated, GH Actions), `POST /api/score` (open, UI). GH Actions calls them sequentially: scrape first, then score.

If more than 10 jobs need AI scoring on a given day, they catch up over subsequent daily runs. Daily inflow is typically <30 candidate jobs, so a one-day backlog is unusual.

### Two-stage scoring

Keyword scoring (`src/lib/scoring/keyword-scorer.ts`) is the cheap gate. AI scoring (`src/lib/scoring/ai-scorer.ts`) only runs for jobs above the keyword threshold and is heavily candidate-specific — the prompt in `ai-scorer.ts` hard-codes the user's resume, salary floor, and preferences. Tuning fit means editing that prompt and the weight tables in `src/lib/constants.ts` (`POSITIVE_SIGNALS`, `NEGATIVE_SIGNALS`), not the scoring logic itself.

The various `SCORE_THRESHOLD_*` constants in `src/lib/constants.ts` are the actual control surface for what surfaces, what gets AI-scored, and what shows up in the (planned) digest.

### Database (`src/lib/db/`)

- Neon serverless driver over **HTTP**, not WebSocket — chosen for short-lived Vercel function invocations. No pooling.
- Three tables: `jobs`, `watched_companies`, `scrape_log`. Schema is the single source of truth; types are `$inferSelect` / `$inferInsert` off the Drizzle tables. Don't redefine job/company types — import them from `@/lib/db/schema`.
- Schema uses Drizzle's camelCase TS columns mapped to snake_case DB columns. The API layer (`src/app/api/jobs/route.ts` PATCH) accepts snake_case keys from clients and explicitly maps them to camelCase — keep this translation in the handler, don't push snake_case into the ORM layer.
- `npm run db:push` is the deployment path. Migrations under `./drizzle/` exist but are not the primary workflow.

### Adding a new ATS scraper

1. Add file under `src/lib/scrapers/` exporting `scrapeX(company: WatchedCompany): Promise<ScrapeResult>`.
2. Wire it into the `switch` in `src/lib/scrapers/index.ts`.
3. Add the literal to the `ATS` union in `src/lib/constants.ts`.
4. Scrapers return `ScrapedJob[]` (snake_case interface in `src/lib/types.ts`) — the cron route maps these to the Drizzle camelCase columns at insert time. Don't return DB-shaped objects from scrapers.

### Path alias

`@/*` → `./src/*` (see `tsconfig.json`). Use it for cross-directory imports.

## Testing

No test runner yet. When adding one, use Vitest (already compatible with the TS/ESM setup).

Priority test targets (pure functions, no I/O, high churn):

- `scoreKeywords()` — run real job descriptions through it, assert score ranges. This is the function you'll tune most often and the one most likely to regress.
- `parseSalary()` — snapshot edge cases: `"$120K-$160K"`, `"$110,000 - $150,000/yr"`, `"Competitive"`, `"DOE"`, `null`.
- `stripHtml()` — Greenhouse descriptions have gnarly HTML with nested tags, entities, and inconsistent line breaks.

Don't test scrapers or API routes directly — they hit external services and the DB. Integration testing for those is manual: run the pipeline and check the tables.

## Production gotchas

### CreativeApplications.net returns 403 from Vercel

The CreativeApplications scraper (`src/lib/scrapers/custom/creativeapplications.ts`) works fine locally but returns `parser_assumption_failed: creativeapplications found 0 #listing_grid-1 .archive .griditem (expected >= 1)` on Vercel — the underlying fetch gets a 403, and `assertLandmark` correctly catches the resulting empty parse. This appears to be IP-based blocking against Vercel's serverless ranges, not anything we can fix in the scraper.

The error surfaces correctly in the Settings Companies tab as ERR with the message in the tooltip. Manual workarounds: scrape locally (works), or proxy through a residential IP. NYFA and MoMA are similarly blocked from Vercel (and locally) — see the Phase 4 spec's "Deferred from Wave A" section.

## Not yet implemented

- **Keyword weights and score thresholds in the Settings UI** — `POSITIVE_SIGNALS`, `NEGATIVE_SIGNALS`, and `SCORE_THRESHOLD_*` are still in `src/lib/constants.ts`. The `/settings` page covers profile, hard filters, watched companies, notifications, and score insights; weight tuning would be next.
- **Company discovery tab in Settings** — Phase 4 spec, Feature 3. Not yet shipped.
- **Custom domain for digest emails** — currently sends from `onboarding@resend.dev`. To use a custom domain, verify it in the Resend dashboard and update the `from` string in `src/lib/notifications/email.ts`.
- **Auth** — None. Single-user app. Service-role DB access server-side only. If this ever becomes multi-user, add RLS then.