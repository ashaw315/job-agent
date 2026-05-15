/**
 * Strip HTML tags and decode common entities.
 * Greenhouse returns job descriptions as HTML; we need plain text for scoring.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract a Greenhouse slug from various board URL formats.
 * e.g. "https://boards.greenhouse.io/artsy" → "artsy"
 *      "https://job-boards.greenhouse.io/glossier" → "glossier"
 *      "https://job-boards.eu.greenhouse.io/wonderstudios" → "wonderstudios"
 */
export function extractGreenhouseSlug(boardUrl: string): string | null {
  const match = boardUrl.match(
    /(?:boards|job-boards)(?:\.[a-z]+)?\.greenhouse\.io\/([^/?#]+)/
  );
  return match ? match[1] : null;
}

/**
 * Extract a Lever slug from a board URL.
 * e.g. "https://jobs.lever.co/doji" → "doji"
 */
export function extractLeverSlug(boardUrl: string): string | null {
  const match = boardUrl.match(/jobs\.lever\.co\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Truncate a string to a max length, adding ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/**
 * Parse salary text into min/max numbers.
 * Handles formats like "$110,000 - $150,000", "$120K-$160K", etc.
 * Returns null values if unparseable.
 */
export function parseSalary(text: string | null): {
  min: number | null;
  max: number | null;
} {
  if (!text) return { min: null, max: null };

  const numbers: number[] = [];
  const regex = /\$?([\d,]+)\s*[kK]?/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let num = parseInt(match[1].replace(/,/g, ""), 10);
    // If the number looks like shorthand (e.g., "120K"), multiply
    if (num < 1000 && /[kK]/.test(text)) {
      num *= 1000;
    }
    // Only include numbers that look like salaries (>= 30k, <= 1M)
    if (num >= 30000 && num <= 1000000) {
      numbers.push(num);
    }
  }

  if (numbers.length === 0) return { min: null, max: null };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/**
 * Normalize a URL for dedup and storage:
 * - Trim whitespace
 * - Validate via URL constructor
 * - Lowercase the host (case-insensitive)
 * - Strip query string and fragment
 * - Strip a single trailing slash from the path (unless the path is "/")
 *
 * Returns null for malformed input.
 *
 * Examples:
 *   "  https://Boards.Greenhouse.io/linear/jobs/123?utm=x/  "
 *     → "https://boards.greenhouse.io/linear/jobs/123"
 *   "https://jobs.lever.co/doji/abc-123/"
 *     → "https://jobs.lever.co/doji/abc-123"
 *   "not-a-url" → null
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  // Only http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.search = "";
  parsed.hash = "";

  // Strip a single trailing slash unless the path is just "/"
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
