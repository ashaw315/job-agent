import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

// ─── Jobs ─────────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    companyName: text("company_name").notNull(),
    companyDisplayName: text("company_display_name"),
    companySize: text("company_size"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryText: text("salary_text"),
    remotePolicy: text("remote_policy"),

    // Categorization
    tier: integer("tier"),
    roleCategory: text("role_category"),

    // Scoring
    keywordScore: real("keyword_score"),
    aiScore: real("ai_score"),
    aiReasoning: text("ai_reasoning"),
    aiGreenFlags: text("ai_green_flags"),
    aiRedFlags: text("ai_red_flags"),
    aiScoredAt: timestamp("ai_scored_at", { withTimezone: true }),

    // Application tracking
    status: text("status").default("new").notNull(),
    appliedDate: timestamp("applied_date", { withTimezone: true }),
    notes: text("notes"),

    // Metadata
    datePosted: timestamp("date_posted", { withTimezone: true }),
    dateScraped: timestamp("date_scraped", { withTimezone: true }).defaultNow().notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    unique("uq_jobs_external_source").on(table.externalId, table.source),
    index("idx_jobs_status").on(table.status),
    index("idx_jobs_keyword_score").on(table.keywordScore),
    index("idx_jobs_ai_score").on(table.aiScore),
    index("idx_jobs_date_scraped").on(table.dateScraped),
    index("idx_jobs_company").on(table.companyName),
  ]
);

// ─── Watched Companies ────────────────────────────────────────────

export const watchedCompanies = pgTable(
  "watched_companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ats: text("ats").notNull(),
    boardUrl: text("board_url").notNull().unique(),
    category: text("category"),
    priority: integer("priority").default(2).notNull(),
    lastScraped: timestamp("last_scraped", { withTimezone: true }),
    lastError: text("last_error"),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    index("idx_watched_active").on(table.isActive),
  ]
);

// ─── Scrape Log ───────────────────────────────────────────────────

export const scrapeLog = pgTable(
  "scrape_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runDate: timestamp("run_date", { withTimezone: true }).defaultNow().notNull(),
    source: text("source").notNull(),
    jobsFound: integer("jobs_found").default(0).notNull(),
    jobsNew: integer("jobs_new").default(0).notNull(),
    errors: text("errors"),
  },
  (table) => [
    index("idx_scrape_log_date").on(table.runDate),
  ]
);

// ─── Settings ─────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Inferred Types ───────────────────────────────────────────────

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type WatchedCompany = typeof watchedCompanies.$inferSelect;
export type NewWatchedCompany = typeof watchedCompanies.$inferInsert;
export type ScrapeLogEntry = typeof scrapeLog.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
