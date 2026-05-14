-- ============================================================
-- Job Search Agent — Initial Schema
-- Run this in the Neon SQL Editor (Dashboard → SQL Editor)
-- OR use: npx drizzle-kit push
-- ============================================================

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  company_name TEXT NOT NULL,
  company_display_name TEXT,
  company_size TEXT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_text TEXT,
  remote_policy TEXT,

  -- Categorization
  tier INTEGER,
  role_category TEXT,

  -- Scoring
  keyword_score REAL,
  ai_score REAL,
  ai_reasoning TEXT,
  ai_scored_at TIMESTAMPTZ,

  -- Application tracking
  status TEXT NOT NULL DEFAULT 'new',
  applied_date TIMESTAMPTZ,
  notes TEXT,

  -- Metadata
  date_posted TIMESTAMPTZ,
  date_scraped TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  UNIQUE(external_id, source)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_keyword_score ON jobs(keyword_score);
CREATE INDEX IF NOT EXISTS idx_jobs_ai_score ON jobs(ai_score);
CREATE INDEX IF NOT EXISTS idx_jobs_date_scraped ON jobs(date_scraped);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_name);

-- Watched companies
CREATE TABLE IF NOT EXISTS watched_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  ats TEXT NOT NULL,
  board_url TEXT NOT NULL UNIQUE,
  category TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  last_scraped TIMESTAMPTZ,
  last_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_watched_active ON watched_companies(is_active);

-- Scrape log
CREATE TABLE IF NOT EXISTS scrape_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  jobs_found INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  errors TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_log_date ON scrape_log(run_date);
