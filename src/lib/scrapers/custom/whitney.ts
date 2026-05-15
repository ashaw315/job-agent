import type { ScrapedJob, ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, ScraperError } from "./util";

const SLUG = "whitney";
const BOARD_URL = "https://whitney.org/about/job-postings";

/**
 * Scrape Whitney's careers page.
 *
 * Page structure: an <h2>"Current Available Positions" inside a div.component.editor-content.
 * Each job is a paragraph (<p class="large">) containing one <a> linking to
 * whitneymuseumofamericanart.applytojob.com/apply/{id}/{slug}.
 *
 * Whitney lists no location, description, or salary in the listing — just title + apply URL.
 * AI scoring works on title alone (less precise but acceptable for cultural institution roles
 * where the title is the strongest signal).
 *
 * external_id: the {id} segment in the apply URL.
 */
export async function scrapeWhitney(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(BOARD_URL);
    assertLandmark($, "a[href*='whitneymuseumofamericanart.applytojob.com/apply/']", SLUG, 1);

    $("a[href*='whitneymuseumofamericanart.applytojob.com/apply/']").each((_, el) => {
      const a = $(el);
      const href = a.attr("href") ?? "";
      const title = a.text().trim();

      // Parse {id} from /apply/{id}/{slug}
      const idMatch = href.match(/\/apply\/([^/]+)\/[^/]+/);
      const externalId = idMatch ? idMatch[1] : null;
      if (!title || !externalId) return;

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: href,
        company_name: SLUG,
        company_display_name: "Whitney Museum of American Art",
        title,
        description: "", // not available on listing page
        location: "New York, NY", // hard-coded — Whitney is in NYC; the apply page may have remote/hybrid info but we don't follow links
        salary_text: null,
        date_posted: null,
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
