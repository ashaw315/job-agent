import { db } from "@/lib/db";
import { jobs as jobsTable, watchedCompanies } from "@/lib/db/schema";
import { eq, desc, max } from "drizzle-orm";
import { relativeDate } from "@/lib/format";
import Dashboard from "@/components/dashboard/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Fetch active jobs, ordered server-side just so the SSR'd HTML is already
  // close to what the client will sort to (default sort is by score desc).
  // The client re-sorts via scoreDisplay() since that interleaves AI + keyword
  // by displayed value, but starting from a near-correct order avoids a flash.
  const [activeJobs, lastScrapeRow, allBoards] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.isActive, true)).orderBy(desc(jobsTable.aiScore), desc(jobsTable.keywordScore)),
    db.select({ ts: max(watchedCompanies.lastScraped) }).from(watchedCompanies),
    db.select({
      name: watchedCompanies.name,
      isActive: watchedCompanies.isActive,
      lastError: watchedCompanies.lastError,
    }).from(watchedCompanies),
  ]);

  const lastScrapedTs = lastScrapeRow[0]?.ts ?? null;
  const boardActiveCount = allBoards.filter(b => b.isActive).length;
  const boardErrorNames = allBoards.filter(b => b.isActive && b.lastError).map(b => b.name);

  return (
    <Dashboard
      initialJobs={activeJobs}
      lastScraped={lastScrapedTs ? relativeDate(lastScrapedTs) + " ago" : null}
      boardActiveCount={boardActiveCount}
      boardErrorNames={boardErrorNames}
    />
  );
}
