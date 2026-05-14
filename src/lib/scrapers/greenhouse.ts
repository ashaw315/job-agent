import { ScrapedJob, ScrapeResult } from "../types";
import { WatchedCompany } from "../db/schema";
import { stripHtml, extractGreenhouseSlug } from "../utils";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  location: { name: string };
  content: string;
  metadata?: Array<{
    id: number;
    name: string;
    value: string | string[] | null;
  }>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

/**
 * Scrape all jobs from a Greenhouse job board.
 *
 * Greenhouse exposes a public JSON API:
 *   GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *
 * Works for both boards.greenhouse.io and job-boards.greenhouse.io URLs —
 * the API endpoint is always boards-api.greenhouse.io.
 */
export async function scrapeGreenhouse(
  company: WatchedCompany
): Promise<ScrapeResult> {
  const slug = extractGreenhouseSlug(company.boardUrl);
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "greenhouse",
    jobs: [],
    error: null,
  };

  if (!slug) {
    result.error = `Could not extract Greenhouse slug from: ${company.boardUrl}`;
    return result;
  }

  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      result.error = `Greenhouse API returned ${res.status} for ${slug}`;
      return result;
    }

    const data: GreenhouseResponse = await res.json();

    result.jobs = data.jobs.map((job) => ({
      external_id: String(job.id),
      source: "greenhouse",
      source_url: job.absolute_url,
      company_name: slug,
      company_display_name: company.name,
      title: job.title,
      description: stripHtml(job.content || ""),
      location: job.location?.name || "",
      salary_text: extractSalaryFromMetadata(job.metadata),
      date_posted: job.updated_at,
    }));

    return result;
  } catch (err) {
    result.error = `${slug}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}

function extractSalaryFromMetadata(
  metadata?: GreenhouseJob["metadata"]
): string | null {
  if (!metadata) return null;
  const salaryField = metadata.find(
    (m) => m.name && /salary|compensation|pay/i.test(m.name) && m.value !== null
  );
  if (!salaryField) return null;
  return Array.isArray(salaryField.value)
    ? salaryField.value.join(", ")
    : salaryField.value;
}
