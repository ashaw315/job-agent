import type { ScrapedJob, ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "builtinnyc";
const BOARD_URL = "https://www.builtinnyc.com/jobs";

/**
 * Scrape BuiltInNYC's NYC jobs feed.
 *
 * Page yields ~19 cards. The actual employer per card is in [data-id="company-title"]
 * — that goes into job.company_display_name. The scraper sets job.company_name to "builtinnyc"
 * (the pseudo-company slug) so dashboard grouping by company_name works.
 *
 * external_id: the numeric job ID at the end of the apply URL path.
 * If the URL pattern changes, the sanity check below will catch it.
 */
export async function scrapeBuiltInNYC(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    assertLandmark($, "[data-id='job-card']", SLUG, 1);

    $("[data-id='job-card']").each((_, el) => {
      const card = $(el);
      const title = card.find("[data-id='job-card-title']").text().trim();
      const companyName = card.find("[data-id='company-title']").text().trim();
      // The job URL is the second <a> in the card — it points to /job/{slug}/{id}
      const links = card.find("a[href^='/job/']");
      const href = links.first().attr("href") ?? "";
      const idMatch = href.match(/\/job\/[^/]+\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : null;
      const sourceUrl = href ? `https://www.builtinnyc.com${href}` : "";

      // Location is harder — card text concatenates: "<company> <title> <postedDate> <workStyle> <location> <salary> <level>..."
      // Best heuristic: pick the substring matching "(City), (State|abbrev)" or "Remote"
      const cleanText = card.text().replace(/\s+/g, " ").trim();
      const locMatch = cleanText.match(/((?:New York|Brooklyn|Manhattan|Queens|Bronx|Staten Island)[,\s][A-Z]{2}|Remote|Hybrid|In-Office)/i);
      const location = locMatch ? locMatch[1] : "";

      if (!title || !externalId) return; // skip malformed

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "BuiltInNYC"
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(cleanText, 1000), // snippet only — no full body on the listing page
        location,
        salary_text: null, // could be extracted from cleanText but lossy; AI scoring runs on description anyway
        date_posted: null, // not exposed in a stable form on the listing page
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
