import * as cheerio from "cheerio";

// CheerioAPI is re-exported as a type-only export from cheerio's root, which
// TypeScript 5.9 (bundler resolution) does not always see.  Deriving it via
// ReturnType is semantically identical and avoids the TS2305 error.
export type CheerioAPI = ReturnType<typeof cheerio.load>;

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
