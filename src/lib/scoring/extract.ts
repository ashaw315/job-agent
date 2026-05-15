import * as cheerio from "cheerio";
import type { ScrapedJob } from "@/lib/types";

// CheerioAPI is re-exported as a type-only export from cheerio's root, which
// TypeScript 5.x (bundler resolution) does not always see.  Deriving it via
// ReturnType is semantically identical and avoids the TS2305 error.
type CheerioAPI = ReturnType<typeof cheerio.load>;

export type ExtractError =
  | "unreachable"
  | "auth_gated"
  | "not_a_job"
  | "extraction_failed";

export interface ExtractResult {
  job?: Omit<ScrapedJob, "external_id" | "source" | "source_url">;
  error?: ExtractError;
}

/**
 * Extract job details from a URL.
 *
 * Strategy:
 * 1. Fetch the page (15s timeout, real-browser UA, follow redirects).
 * 2. Try JSON-LD JobPosting extraction. If it produces a title and description >= 200 chars, use it.
 * 3. Otherwise, fall back to a Claude API extraction call on the cleaned HTML.
 *
 * Returns the job fields needed by scoreKeywords + scoreWithAI. The caller
 * (route handler) fills in external_id, source, source_url.
 */
export async function extractJobFromUrl(url: string): Promise<ExtractResult> {
  // Step 1: fetch
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("extract: fetch failed:", err instanceof Error ? err.message : err);
    return { error: "unreachable" };
  }

  if (!res.ok) {
    console.warn(`extract: HTTP ${res.status} for ${url}`);
    return { error: "unreachable" };
  }

  // Reject non-HTML responses up front (PDFs, JSON APIs, etc.)
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("html")) {
    console.warn(`extract: non-HTML content-type "${contentType}" for ${url}`);
    return { error: "extraction_failed" };
  }

  const html = await res.text();

  // Soft-block / auth-wall heuristic
  if (html.length < 500) {
    return { error: "auth_gated" };
  }
  const lower = html.toLowerCase();
  const hasLoginText = lower.includes("sign in") || lower.includes("log in");
  if (hasLoginText && html.length < 5000) {
    return { error: "auth_gated" };
  }

  const $ = cheerio.load(html);

  // Step 2: try JSON-LD
  const fromJsonLd = tryExtractJsonLd($);
  if (fromJsonLd && isExtractionGoodEnough(fromJsonLd)) {
    return { job: fromJsonLd };
  }

  // Step 3: fall back to Claude
  return tryExtractClaude($, html);
}

/**
 * Returns true if a JSON-LD extraction produced enough data to skip the Claude fallback:
 * a non-empty title AND a description of at least 200 plain-text chars.
 */
function isExtractionGoodEnough(j: Omit<ScrapedJob, "external_id" | "source" | "source_url">): boolean {
  if (!j.title || j.title.trim().length === 0) return false;
  if (!j.description || j.description.length < 200) return false;
  return true;
}

// Implementations below get filled in by Task 4 (JSON-LD) and Task 5 (Claude).
function tryExtractJsonLd(_$: CheerioAPI): Omit<ScrapedJob, "external_id" | "source" | "source_url"> | null {
  return null;
}

async function tryExtractClaude(_$: CheerioAPI, _html: string): Promise<ExtractResult> {
  return { error: "extraction_failed" };
}
