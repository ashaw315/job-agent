// DB types are inferred from Drizzle schema — import from "@/lib/db/schema"
// This file holds scraper, scoring, and API types only.

// ─── Scraper Types ────────────────────────────────────────────────

/** Raw job data from a scraper, before insertion. */
export interface ScrapedJob {
  external_id: string;
  source: string;
  source_url: string;
  company_name: string;
  company_display_name: string;
  title: string;
  description: string;
  location: string;
  salary_text: string | null;
  date_posted: string | null;
}

export interface ScrapeResult {
  companyId: string;
  companyName: string;
  ats: string;
  jobs: ScrapedJob[];
  error: string | null;
}

// ─── AI Scoring Types ─────────────────────────────────────────────

export interface AIScoreResponse {
  score: number;
  reasoning: string;
  tier: 1 | 2 | 3;
  role_category: string;
  salary_estimate: string;
  red_flags: string;
  green_flags: string;
}

// ─── API Response Types ───────────────────────────────────────────

export interface CronRunSummary {
  run_date: string;
  total_companies_scraped: number;
  total_jobs_found: number;
  total_new_jobs: number;
  errors: string[];
  ai_scores_run: number;
}
