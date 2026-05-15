import type { ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "weworkremotely";
const FEED_URL = "https://weworkremotely.com/categories/remote-programming-jobs.rss";

/**
 * Scrape We Work Remotely's RSS feed. Content negotiation: when we send
 * Accept: application/rss+xml, the URL returns RSS, not HTML.
 *
 * RSS items have:
 *   <title>Company: Job Title</title>  (or sometimes just Job Title — split on first ":")
 *   <link>https://weworkremotely.com/remote-jobs/{slug}</link>
 *   <region>Anywhere in the World / Europe / etc.</region>
 *   <category>Full-Stack Programming / Back-End / etc.</category>
 *   <pubDate>RFC 2822 date string</pubDate>
 *   <description>HTML body</description>
 *
 * external_id: the URL slug at the end of the link path.
 */
export async function scrapeWeWorkRemotely(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(FEED_URL, { xmlMode: true });
    assertLandmark($, "item", SLUG, 1);

    $("item").each((_, el) => {
      const item = $(el);
      const rawTitle = item.find("title").first().text().trim();
      const link = item.find("link").first().text().trim();
      const region = item.find("region").first().text().trim();
      const pubDate = item.find("pubDate").first().text().trim();
      const descHtml = item.find("description").first().text();

      // Title format "Company: Job Title" → split on first colon
      let companyName = "";
      let title = rawTitle;
      const colonIdx = rawTitle.indexOf(":");
      if (colonIdx > 0 && colonIdx < 50) {
        companyName = rawTitle.slice(0, colonIdx).trim();
        title = rawTitle.slice(colonIdx + 1).trim();
      }

      // external_id from URL slug
      const idMatch = link.match(/\/remote-jobs\/([^/?#]+)/);
      const externalId = idMatch ? idMatch[1] : null;
      if (!title || !externalId) return;

      // Strip HTML from description for storage
      const plainDesc = descHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: link,
        company_name: SLUG,
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(plainDesc, 4000),
        location: region || "Remote",
        salary_text: null, // not in RSS
        date_posted: pubDate ? new Date(pubDate).toISOString() : null,
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
