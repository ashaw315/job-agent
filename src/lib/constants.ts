type ATS = "greenhouse" | "lever" | "ashby" | "custom";
type CompanyCategory =
  | "art_world" | "design_forward" | "ai" | "studio"
  | "brand" | "tech" | "startup" | "museum" | "media" | "aggregator";

// ─── Scoring Weights ──────────────────────────────────────────────

export const POSITIVE_SIGNALS = {
  title_exact: {
    weight: 30,
    terms: [
      "creative technologist",
      "design engineer",
      "creative developer",
      "creative operations",
      "creative producer",
      "digital producer",
    ],
  },
  title_partial: {
    weight: 15,
    terms: ["creative", "design", "frontend", "full stack", "full-stack"],
  },
  description_strong: {
    weight: 10, // per match, capped at 30
    cap: 30,
    terms: [
      "mfa",
      "fine art",
      "creative coding",
      "interdisciplinary",
      "maker",
      "fabrication",
      "installation",
      "physical and digital",
      "art and technology",
      "design and engineering",
    ],
  },
  description_moderate: {
    weight: 5, // per match, capped at 20
    cap: 20,
    terms: [
      "react",
      "next.js",
      "typescript",
      "rails",
      "node.js",
      "museum",
      "gallery",
      "exhibition",
      "cultural",
      "figma",
      "design system",
      "animation",
      "interactive",
      "ai",
      "generative",
      "three.js",
      "webgl",
      "p5.js",
    ],
  },
  location_nyc: {
    weight: 10,
    terms: ["new york", "nyc", "brooklyn", "manhattan"],
  },
  location_remote: {
    weight: 5,
    terms: ["remote", "anywhere"],
  },
} as const;

export const NEGATIVE_SIGNALS = {
  title_negative: {
    weight: -30,
    terms: [
      "senior director",
      "vp ",
      "vice president",
      "chief",
      "head of",
      "principal",
      "staff engineer",
      "adjunct",
      "professor",
      "intern",
    ],
  },
  description_negative: {
    weight: -15,
    terms: [
      "10+ years",
      "12+ years",
      "15+ years",
      "security clearance required",
      "phd required",
      "contract",
      "1099",
    ],
  },
  experience_mismatch: {
    weight: -20,
    terms: [
      "8+ years of art direction",
      "7+ years of creative direction",
      "10+ years of product management",
    ],
  },
} as const;

// Keyword score thresholds
export const SCORE_THRESHOLD_ARCHIVE = 35;
export const SCORE_THRESHOLD_SURFACE = 50;
export const SCORE_THRESHOLD_AI = 45; // Minimum keyword score to trigger AI scoring
export const SCORE_THRESHOLD_DIGEST_TOP = 70; // AI score for "top jobs" in digest
export const SCORE_THRESHOLD_DIGEST_INTERESTING = 50; // AI score for "interesting" in digest

// AI scoring config
export const AI_SCORING_MODEL = "claude-sonnet-4-20250514";
export const AI_SCORING_MAX_TOKENS = 500;
export const AI_SCORING_MAX_PER_RUN = 30; // Max AI calls per cron run

// ─── Initial Watched Companies ────────────────────────────────────

export interface CompanySeed {
  name: string;
  ats: ATS;
  board_url: string;
  category: CompanyCategory;
  priority?: 1 | 2 | 3;
  is_active?: boolean;
  custom_scraper?: string;
}

export const INITIAL_COMPANIES: CompanySeed[] = [
  // Art world / cultural
  {
    name: "Artsy",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/artsy",
    category: "art_world",
    priority: 1,
    is_active: false, // private board, needs custom scraper
  },
  {
    name: "Sothebys",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/sothebys",
    category: "art_world",
    priority: 1,
  },

  // Design-forward tech
  {
    name: "Vercel",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/vercel",
    category: "design_forward",
  },
  {
    name: "Linear",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/Linear",
    category: "design_forward",
  },
  {
    name: "Figma",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/figma",
    category: "design_forward",
  },
  {
    name: "Notion",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/notion",
    category: "design_forward",
  },
  {
    name: "Stripe",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/stripe",
    category: "design_forward",
  },
  {
    name: "Resend",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/resend",
    category: "design_forward",
  },
  {
    name: "Raycast",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/raycast",
    category: "design_forward",
  },
  {
    name: "The Browser Company",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/the%20browser%20company",
    category: "design_forward",
  },

  // AI companies
  {
    name: "ElevenLabs",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/elevenlabs",
    category: "ai",
  },
  {
    name: "Runway",
    ats: "ashby",
    board_url: "https://jobs.ashbyhq.com/runway-ml",
    category: "ai",
    priority: 1,
  },

  // Creative studios / agencies
  {
    name: "Wonder Studios",
    ats: "greenhouse",
    board_url: "https://job-boards.eu.greenhouse.io/wonderstudios",
    category: "studio",
  },
  {
    name: "Deeplocal",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/deeplocal",
    category: "studio",
  },

  // Brand / media
  {
    name: "Glossier",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/glossier",
    category: "brand",
  },
  {
    name: "Duolingo",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/duolingo",
    category: "tech",
  },
  {
    name: "Headway",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/headway",
    category: "tech",
  },

  // Lever companies
  {
    name: "Doji",
    ats: "lever",
    board_url: "https://jobs.lever.co/doji",
    category: "startup",
    is_active: false, // company appears dead / not hiring
  },

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
  {
    name: "Awwwards",
    ats: "custom",
    board_url: "https://www.awwwards.com/jobs/",
    category: "aggregator",
    custom_scraper: "awwwards",
    priority: 1,
  },
  {
    name: "CreativeApplications",
    ats: "custom",
    board_url: "https://www.creativeapplications.net/jobs/",
    category: "aggregator",
    custom_scraper: "creativeapplications",
    priority: 1,
  },
  {
    name: "Dribbble",
    ats: "custom",
    board_url: "https://dribbble.com/jobs",
    category: "aggregator",
    custom_scraper: "dribbble",
    priority: 1,
  },
  {
    name: "Mediabistro",
    ats: "custom",
    board_url: "https://www.mediabistro.com/jobs?location=New+York",
    category: "aggregator",
    custom_scraper: "mediabistro",
    priority: 2,
  },
  {
    name: "1stDibs",
    ats: "greenhouse",
    board_url: "https://boards.greenhouse.io/1stdibscom",
    category: "art_world",
    priority: 1,
  },
  {
    name: "Vox Media",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/voxmedia",
    category: "media",
    priority: 2,
  },
  {
    name: "New York Times",
    ats: "greenhouse",
    board_url: "https://job-boards.greenhouse.io/thenewyorktimes",
    category: "media",
    priority: 1,
  },
];
