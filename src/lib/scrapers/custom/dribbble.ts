import type { ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "dribbble";
const DEFAULT_BOARD_URL = "https://dribbble.com/jobs";

/**
 * Scrape Dribbble's Jobs board — design and creative roles, primarily product/visual/UX design.
 *
 * Page yields ~50 cards under li.job-list-item (featured + standard listings mixed).
 * Each card carries clean class-named fields:
 *   .job-board-job-company → company name
 *   h4.job-board-job-title (also .job-title) → title
 *   span.location → location (own text, since a sibling SVG icon also sits inside .location-container)
 * Job permalinks: /jobs/<numeric-id>-<slug> — each card has two copies of the link
 * (?source=index variant + plain). The numeric id is the natural external_id.
 */
export async function scrapeDribbble(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(company.boardUrl || DEFAULT_BOARD_URL);
    assertLandmark($, "li.job-list-item", SLUG, 1);

    $("li.job-list-item").each((_, el) => {
      const card = $(el);

      const title = card.find("h4.job-board-job-title").first().text().replace(/\s+/g, " ").trim();
      const companyName = card.find(".job-board-job-company").first().text().replace(/\s+/g, " ").trim();
      // .location-container holds an SVG icon + .location span; the span has the clean text.
      const location = card.find("span.location").first().text().replace(/\s+/g, " ").trim();

      // Find the canonical job URL: /jobs/<id>-<slug> (numeric id required).
      const link = card.find("a[href^='/jobs/']").filter((_, a) => {
        const h = $(a).attr("href") ?? "";
        return /\/jobs\/\d+-/.test(h);
      }).first();
      const href = link.attr("href") ?? "";
      // Strip any ?source=index query before matching to keep external_id stable
      const cleanHref = href.split("?")[0];
      const idMatch = cleanHref.match(/\/jobs\/(\d+)-/);
      const externalId = idMatch ? idMatch[1] : null;
      const sourceUrl = cleanHref ? `https://dribbble.com${cleanHref}` : "";

      if (!title || !externalId) return; // skip malformed

      // Description: the card's full text (minus the boilerplate badges) is the
      // best snippet we get from a listing page. AI scoring runs on this.
      const cardText = card.text().replace(/\s+/g, " ").trim();

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "Dribbble"
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(cardText, 1000),
        location,
        salary_text: null, // not exposed in the listing card
        date_posted: null, // relative-date strings ("day3"); not parsed
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
