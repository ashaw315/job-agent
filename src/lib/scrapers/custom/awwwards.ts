import type { ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "awwwards";
const BOARD_URL = "https://www.awwwards.com/jobs/";

/**
 * Scrape Awwwards' Jobs board — creative-developer, design-engineer, interactive-developer roles.
 *
 * Page yields ~12 cards under .card-job. Each card has:
 *   .card-job__title  → job title
 *   .card-job__header__left  → company name (text)
 *   .card-job__header__right → location text (city or "Remote")
 * Job posting URLs follow /jobs/<slug>.html (the trailing .html distinguishes posts from
 * category/country pages like /jobs/design/ or /jobs/Germany/).
 *
 * external_id: the slug-with-dashes portion of the URL.
 * date_posted: not parsed — Awwwards displays relative dates ("3 days ago") that aren't
 * trivially convertible to ISO. The dashboard falls back to date_scraped for recency display.
 */
export async function scrapeAwwwards(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    assertLandmark($, ".card-job", SLUG, 1);

    $(".card-job").each((_, el) => {
      const card = $(el);
      const title = card.find(".card-job__title").text().trim();
      const companyName = card.find(".card-job__header__left").text().trim();
      const location = card.find(".card-job__header__right").text().trim();

      // Find the job's permalink — exclude category/country pages by requiring .html ending
      const links = card.find("a[href*='/jobs/']").filter((_, a) => {
        const h = $(a).attr("href") ?? "";
        return /\/jobs\/[a-z0-9][a-z0-9-]*\.html$/i.test(h);
      });
      const href = links.first().attr("href") ?? "";
      const slugMatch = href.match(/\/jobs\/([a-z0-9][a-z0-9-]*)\.html$/i);
      const externalId = slugMatch ? slugMatch[1] : null;
      const sourceUrl = href
        ? (href.startsWith("http") ? href : `https://www.awwwards.com${href}`)
        : "";

      if (!title || !externalId) return; // skip malformed

      // Description: the listing page only shows a snippet; use the card's full text
      // (company + location + title + any teaser text) as a stand-in for AI scoring.
      const cardText = card.text().replace(/\s+/g, " ").trim();

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "Awwwards"
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(cardText, 1000),
        location,
        salary_text: null,
        date_posted: null, // relative-date strings; not parsed
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
