import type { ScrapeResult } from "@/lib/types";
import type { WatchedCompany } from "@/lib/db/schema";
import { fetchAndParse, assertLandmark, truncateDescription, ScraperError } from "./util";

const SLUG = "mediabistro";
const DEFAULT_BOARD_URL = "https://www.mediabistro.com/jobs?location=New+York";

/**
 * Scrape Mediabistro's NYC-filtered jobs feed — editorial, creative, marketing, and media-tech.
 *
 * Page yields ~9 cards under main ul li. Each card is a single <a> wrapping a Tailwind-styled
 * panel. The Tailwind class names (text-base, leading-7, etc.) are fragile — instead we rely
 * on the semantic structure:
 *   - h3 inside the card holds the job title (stable landmark — also the assertLandmark anchor)
 *   - <p> elements inside the card carry company, "X days ago", salary, location, employment type,
 *     and a description snippet, in that order.
 *
 * URL pattern: /jobs/<numeric-id>-<slug>. The numeric id is the external_id.
 *
 * Location parsing relies on the card's <p> elements being in their documented order.
 * If Mediabistro reshuffles the card layout, assertLandmark won't catch it (the title still
 * exists), but the location field may end up wrong or empty. We accept this — losing a location
 * is a soft failure; losing the entire job is what assertLandmark guards against.
 */
export async function scrapeMediabistro(company: WatchedCompany): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    companyId: company.id,
    companyName: company.name,
    ats: "custom",
    jobs: [],
    error: null,
  };

  try {
    const $ = await fetchAndParse(company.boardUrl || DEFAULT_BOARD_URL);
    assertLandmark($, "main ul li h3", SLUG, 1);

    $("main ul li").each((_, el) => {
      const card = $(el);

      const title = card.find("h3").first().text().replace(/\s+/g, " ").trim();

      // <p> elements in documented order: company, posted-date, salary, location, employment-type, snippet.
      const paragraphs: string[] = [];
      card.find("p").each((_, p) => {
        paragraphs.push($(p).text().replace(/\s+/g, " ").trim());
      });
      const companyName = paragraphs[0] ?? "";
      // paragraphs[1] is "X days ago" — relative date, not parsed.
      // Heuristic for salary vs. location: scan paragraphs[2..4] and pick the first match.
      const looksLikeSalary = (s: string) => /\$|[0-9]{2,}k\b|[0-9]{3},[0-9]{3}/i.test(s);
      const looksLikeLocation = (s: string) => /,\s*[A-Z]{2}\b|remote|hybrid|usa|united states|new york|brooklyn/i.test(s);

      let salaryText: string | null = null;
      let location = "";
      for (let i = 2; i <= 4 && i < paragraphs.length; i++) {
        const p = paragraphs[i];
        if (!p) continue;
        if (!salaryText && looksLikeSalary(p)) salaryText = p;
        else if (!location && looksLikeLocation(p)) location = p;
      }
      // Description snippet is the last <p>
      const description = paragraphs[paragraphs.length - 1] ?? "";

      // URL
      const link = card.find("a[href^='/jobs/']").first();
      const href = link.attr("href") ?? "";
      const idMatch = href.match(/\/jobs\/(\d+)-/);
      const externalId = idMatch ? idMatch[1] : null;
      const sourceUrl = href ? `https://www.mediabistro.com${href}` : "";

      if (!title || !externalId) return; // skip malformed

      result.jobs.push({
        external_id: externalId,
        source: SLUG,
        source_url: sourceUrl,
        company_name: SLUG, // the pseudo-company "Mediabistro"
        company_display_name: companyName || "Unknown",
        title,
        description: truncateDescription(description, 1000),
        location,
        salary_text: salaryText,
        date_posted: null, // relative dates ("23 days ago"); not parsed
      });
    });

    return result;
  } catch (err) {
    result.error = err instanceof ScraperError ? err.message : `${SLUG}: ${err instanceof Error ? err.message : "Unknown error"}`;
    return result;
  }
}
