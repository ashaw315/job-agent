import * as cheerio from "cheerio";
import { stripHtml } from "@/lib/utils";
import type { ScrapedJob } from "@/lib/types";
import { AI_SCORING_MODEL } from "@/lib/constants";

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
function tryExtractJsonLd(
  $: CheerioAPI
): Omit<ScrapedJob, "external_id" | "source" | "source_url"> | null {
  const scripts = $("script[type='application/ld+json']");
  if (scripts.length === 0) return null;

  for (const el of scripts.toArray()) {
    const raw = $(el).contents().text();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    // A page can ship an array of JSON-LD objects, a single object, or a @graph wrapper.
    const candidates = collectLdCandidates(parsed);
    for (const c of candidates) {
      if (isJobPosting(c)) {
        const built = buildFromJobPosting(c);
        if (built) return built;
      }
    }
  }

  return null;
}

/** Flatten JSON-LD shapes into a list of candidate objects to inspect. */
function collectLdCandidates(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectLdCandidates);
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown>[] = [obj];
    if (Array.isArray(obj["@graph"])) {
      out.push(...(obj["@graph"] as unknown[]).flatMap(collectLdCandidates));
    }
    return out;
  }
  return [];
}

function isJobPosting(obj: Record<string, unknown>): boolean {
  const t = obj["@type"];
  if (typeof t === "string") return t === "JobPosting";
  if (Array.isArray(t)) return t.includes("JobPosting");
  return false;
}

function buildFromJobPosting(
  obj: Record<string, unknown>
): Omit<ScrapedJob, "external_id" | "source" | "source_url"> | null {
  const title = pickString(obj["title"]);
  if (!title) return null;

  const orgRaw = obj["hiringOrganization"];
  const companyName = isObj(orgRaw) ? pickString(orgRaw["name"]) ?? "" : "";

  const descHtml = pickString(obj["description"]) ?? "";
  // Strip HTML to plain text using the existing stripHtml helper from utils.
  const description = stripHtml(descHtml);

  const location = pickLocation(obj["jobLocation"]);

  const salaryText = pickSalary(obj["baseSalary"]);

  const datePosted = pickString(obj["datePosted"]) ?? null;

  return {
    company_name: companyName,
    company_display_name: companyName,
    title,
    description,
    location,
    salary_text: salaryText,
    date_posted: datePosted,
  };
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * jobLocation can be an object, an array of objects, or missing.
 * Try to read address.addressLocality + addressRegion when present.
 */
function pickLocation(v: unknown): string {
  const first = Array.isArray(v) ? v[0] : v;
  if (!isObj(first)) return "";
  const addr = first["address"];
  if (!isObj(addr)) return "";
  const city = pickString(addr["addressLocality"]) ?? "";
  const region = pickString(addr["addressRegion"]) ?? "";
  return [city, region].filter(Boolean).join(", ");
}

/**
 * baseSalary can be a string, a number, or an object with `value` (object or scalar).
 * Best-effort string conversion. Returns null if no usable info.
 */
function pickSalary(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (!isObj(v)) return null;
  const value = v["value"];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isObj(value)) {
    const min = value["minValue"];
    const max = value["maxValue"];
    if (typeof min === "number" || typeof max === "number") {
      return [min, max].filter(n => typeof n === "number").join(" - ");
    }
  }
  return null;
}

async function tryExtractClaude(
  $: CheerioAPI,
  html: string
): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("extract: ANTHROPIC_API_KEY not set, cannot fall back to Claude");
    return { error: "extraction_failed" };
  }

  // Pre-clean: drop obvious noise tags so the truncate-at-20KB leaves real content
  $("script, style, nav, footer, header").remove();
  let cleaned = $.root().html() ?? "";
  if (cleaned.length > 20000) cleaned = cleaned.slice(0, 20000);

  // Fall back to raw HTML if cheerio rendering produced nothing meaningful
  if (cleaned.length < 200) {
    cleaned = html.slice(0, 20000);
  }

  const prompt = `You are extracting job posting details from a webpage's HTML.

Extract these fields as JSON. If a field is genuinely not present, set it to null.

Output JSON only, no markdown fences:
{"title": <string>, "company_name": <string>, "location": <string|null>, "salary_text": <string|null>, "description": <string>, "remote_policy": <"onsite"|"hybrid"|"remote"|null>}

The description should be the full job description text (not HTML), 200+ characters where possible. If the page doesn't look like a job posting at all, return {"title": null, "company_name": null, "location": null, "salary_text": null, "description": null, "remote_policy": null}.

HTML (may be truncated):
${cleaned}`;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_SCORING_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    console.error("extract Claude: fetch failed:", err instanceof Error ? err.message : err);
    return { error: "extraction_failed" };
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`extract Claude: HTTP ${res.status}: ${body.slice(0, 200)}`);
    return { error: "extraction_failed" };
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: {
    title: string | null;
    company_name: string | null;
    location: string | null;
    salary_text: string | null;
    description: string | null;
    remote_policy: string | null;
  };
  try {
    parsed = JSON.parse(clean);
  } catch (err) {
    console.error("extract Claude: JSON parse failed:", err);
    return { error: "extraction_failed" };
  }

  // "Not a job posting" — Claude returned all nulls
  if (!parsed.title && !parsed.description) {
    return { error: "not_a_job" };
  }

  // Require at least a title — without it scoring is meaningless
  if (!parsed.title) {
    return { error: "extraction_failed" };
  }

  return {
    job: {
      title: parsed.title,
      company_name: parsed.company_name ?? "Unknown",
      company_display_name: parsed.company_name ?? "Unknown",
      description: parsed.description ?? "",
      location: parsed.location ?? "",
      salary_text: parsed.salary_text,
      date_posted: null,
    },
  };
}
