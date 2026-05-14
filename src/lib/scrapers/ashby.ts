import { ScrapedJob, ScrapeResult } from "../types";
import { WatchedCompany } from "../db/schema";
import { stripHtml } from "../utils";

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  publishedDate: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  isRemote?: boolean;
  compensation?: { compensationTierSummary?: string };
  jobUrl?: string;
  publishedAt?: string;
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

function extractAshbySlug(boardUrl: string): string | null {
  const match = boardUrl.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Scrape all postings from an Ashby job board.
 *   GET https://api.ashbyhq.com/posting-api/job-board/{org}
 * POST on the same path returns 401 even for valid slugs.
 */
export async function scrapeAshby(
  company: WatchedCompany
): Promise<ScrapeResult> {
  const slug = extractAshbySlug(company.boardUrl);
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "ashby",
    jobs: [],
    error: null,
  };

  if (!slug) {
    result.error = `Could not extract Ashby slug from: ${company.boardUrl}`;
    return result;
  }

  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      result.error = `Ashby API returned ${res.status} for ${slug}`;
      return result;
    }

    const data: AshbyResponse = await res.json();

    if (!data.jobs || !Array.isArray(data.jobs)) {
      result.error = `Ashby returned unexpected data format for ${slug}`;
      return result;
    }

    result.jobs = data.jobs.map((job) => ({
      external_id: job.id,
      source: "ashby",
      source_url: job.jobUrl || `https://jobs.ashbyhq.com/${slug}/${job.id}`,
      company_name: slug,
      company_display_name: company.name,
      title: job.title,
      description: job.descriptionPlain || stripHtml(job.descriptionHtml || ""),
      location: job.location || (job.isRemote ? "Remote" : ""),
      salary_text: job.compensation?.compensationTierSummary || null,
      date_posted: job.publishedAt || job.publishedDate || null,
    }));

    return result;
  } catch (err) {
    result.error = `${slug}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
