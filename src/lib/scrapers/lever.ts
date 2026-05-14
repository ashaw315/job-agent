import { ScrapedJob, ScrapeResult } from "../types";
import { WatchedCompany } from "../db/schema";
import { extractLeverSlug } from "../utils";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  descriptionPlain?: string;
  additionalPlain?: string;
  categories: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
  };
  salaryRange?: {
    min: number;
    max: number;
    currency: string;
    interval: string;
  };
}

/**
 * Scrape all postings from a Lever job board.
 *
 * Lever public API:
 *   GET https://api.lever.co/v0/postings/{company}
 */
export async function scrapeLever(
  company: WatchedCompany
): Promise<ScrapeResult> {
  const slug = extractLeverSlug(company.boardUrl);
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "lever",
    jobs: [],
    error: null,
  };

  if (!slug) {
    result.error = `Could not extract Lever slug from: ${company.boardUrl}`;
    return result;
  }

  try {
    const url = `https://api.lever.co/v0/postings/${slug}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      result.error = `Lever API returned ${res.status} for ${slug}`;
      return result;
    }

    const data: LeverPosting[] = await res.json();

    if (!Array.isArray(data)) {
      result.error = `Lever returned unexpected data format for ${slug}`;
      return result;
    }

    result.jobs = data.map((posting) => ({
      external_id: posting.id,
      source: "lever",
      source_url: posting.hostedUrl,
      company_name: slug,
      company_display_name: company.name,
      title: posting.text,
      description: posting.descriptionPlain || posting.additionalPlain || "",
      location: posting.categories?.location || "",
      salary_text: formatLeverSalary(posting.salaryRange),
      date_posted: new Date(posting.createdAt).toISOString(),
    }));

    return result;
  } catch (err) {
    result.error = `${slug}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}

function formatLeverSalary(range?: LeverPosting["salaryRange"]): string | null {
  if (!range) return null;
  const { min, max, currency, interval } = range;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  return `${fmt(min)} - ${fmt(max)} / ${interval}`;
}
