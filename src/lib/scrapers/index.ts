import { WatchedCompany } from "../db/schema";
import { ScrapeResult } from "../types";
import { scrapeGreenhouse } from "./greenhouse";
import { scrapeLever } from "./lever";
import { scrapeAshby } from "./ashby";

/**
 * Route to the correct scraper based on ATS type.
 */
export async function scrapeCompany(
  company: WatchedCompany
): Promise<ScrapeResult> {
  const base: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: company.ats,
    jobs: [],
    error: null,
  };

  switch (company.ats) {
    case "greenhouse":
      return scrapeGreenhouse(company);
    case "lever":
      return scrapeLever(company);
    case "ashby":
      return scrapeAshby(company);
    case "custom":
      return { ...base, error: `Custom scraper not implemented for ${company.name}` };
    default:
      return { ...base, error: `Unknown ATS: ${company.ats}` };
  }
}

/**
 * Scrape multiple companies with concurrency control.
 * Batches of 5 to avoid rate limiting.
 */
export async function scrapeAll(
  companies: WatchedCompany[]
): Promise<ScrapeResult[]> {
  const CONCURRENCY = 5;
  const results: ScrapeResult[] = [];

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(scrapeCompany));
    results.push(...batchResults);
  }

  return results;
}
