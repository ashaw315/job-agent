import type { ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "creativeapplications";
const BOARD_URL = "https://www.creativeapplications.net/jobs/";

/**
 * Scrape CreativeApplications.net's job board — generative art, new media, creative coding,
 * and academic-research roles.
 *
 * Page is a WordPress archive (post-type-archive-jobs). The grid view at
 * #listing_grid-1 .archive contains div.griditem children. Each has TWO matching
 * /jobs/<slug>/ links (one wraps the thumbnail, one wraps the title) — both have the
 * same href, so we pick the first. The canonical title is in <div class="gridtitle">.
 * The intro snippet lives in <div class="gridexcerpt">.
 *
 * external_id: the URL slug (the post-slug after /jobs/).
 * location: left blank — CA embeds location in the title prose ("at Yale College", "at Texas
 * Tech University"). Parsing institution names from arbitrary titles is fragile; the keyword
 * scorer reads location signals from the title and description text directly.
 * date_posted: not exposed in the grid view (the homepage firehose has dates, the archive
 * doesn't). The dashboard falls back to date_scraped for recency display.
 */
export async function scrapeCreativeApplications(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    // Sanity: grid container exists AND at least one griditem inside it.
    assertLandmark($, "#listing_grid-1 .archive .griditem", SLUG, 1);

    $("#listing_grid-1 .archive .griditem").each((_, el) => {
      const item = $(el);

      // The title is inside <div class="gridtitle"> nested inside the title-link.
      // Each griditem has two matching links (one wraps the image, one wraps the title);
      // .gridtitle gives us the canonical title text without picking the right link.
      const title = item.find(".gridtitle").text().replace(/\s+/g, " ").trim();

      // URL: take the first /jobs/<slug>/ link — both link copies have the same href.
      const link = item.find("a[href*='/jobs/']").filter((_, a) => {
        const h = $(a).attr("href") ?? "";
        return /\/jobs\/[a-z0-9][a-z0-9-]+\/?$/i.test(h);
      }).first();
      const href = link.attr("href") ?? "";
      const slugMatch = href.match(/\/jobs\/([a-z0-9][a-z0-9-]+)\/?$/i);
      const externalId = slugMatch ? slugMatch[1] : null;
      const sourceUrl = href
        ? (href.startsWith("http") ? href : `https://www.creativeapplications.net${href}`)
        : "";

      if (!title || !externalId) return; // skip malformed

      // Description: take the griditem's excerpt block (.gridexcerpt) which holds the
      // intro paragraph. Falls back to the full item text minus the title if absent.
      let description = item.find(".gridexcerpt").text().replace(/\s+/g, " ").trim();
      if (!description) {
        const itemText = item.text().replace(/\s+/g, " ").trim();
        description = itemText.startsWith(title) ? itemText.slice(title.length).trim() : itemText;
      }

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "CreativeApplications"
        company_display_name: "CreativeApplications", // CA doesn't list per-post company info
        title,
        description: truncateDescription(description, 2000),
        location: "", // embedded in title prose; left blank
        salary_text: null,
        date_posted: null, // not exposed in the grid view; dashboard falls back to date_scraped
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
