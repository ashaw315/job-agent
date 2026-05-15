import type { WatchedCompany } from "@/lib/db/schema";
import type { ScrapeResult } from "@/lib/types";
import { scrapeBuiltInNYC } from "./builtinnyc";
import { scrapeWeWorkRemotely } from "./weworkremotely";
import { scrapeWhitney } from "./whitney";
import { scrapeAwwwards } from "./awwwards";
import { scrapeCreativeApplications } from "./creativeapplications";

type CustomScraperFn = (c: WatchedCompany) => Promise<ScrapeResult>;

/**
 * Registry mapping watched_companies.custom_scraper slug → parser function.
 *
 * To add a new custom scraper:
 * 1. Create src/lib/scrapers/custom/{slug}.ts exporting a function with this signature.
 * 2. Import it here and add an entry to CUSTOM_SCRAPERS.
 * 3. Add a watched_companies row with ats='custom' and custom_scraper='{slug}'.
 *    Either via INITIAL_COMPANIES + reseed, or via the Settings UI.
 */
export const CUSTOM_SCRAPERS: Record<string, CustomScraperFn> = {
  builtinnyc: scrapeBuiltInNYC,
  weworkremotely: scrapeWeWorkRemotely,
  whitney: scrapeWhitney,
  awwwards: scrapeAwwwards,
  creativeapplications: scrapeCreativeApplications,
};

export function getCustomScraper(slug: string | null): CustomScraperFn | null {
  if (!slug) return null;
  return CUSTOM_SCRAPERS[slug] ?? null;
}
