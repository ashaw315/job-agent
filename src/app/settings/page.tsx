import { db } from "@/lib/db";
import { jobs as jobsTable, watchedCompanies } from "@/lib/db/schema";
import { count, max, asc } from "drizzle-orm";
import Topbar from "@/components/dashboard/Topbar";
import Settings from "@/components/settings/Settings";
import { getProfile } from "@/lib/settings/profile";
import { getHardFilters } from "@/lib/settings/hard-filters";
import { relativeDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, hardFilters, companies, jobsCountRow, lastScrapeRow] = await Promise.all([
    getProfile(),
    getHardFilters(),
    db
      .select()
      .from(watchedCompanies)
      .orderBy(asc(watchedCompanies.priority), asc(watchedCompanies.name)),
    db.select({ n: count() }).from(jobsTable),
    db.select({ ts: max(watchedCompanies.lastScraped) }).from(watchedCompanies),
  ]);

  const jobsTotal = Number(jobsCountRow[0]?.n ?? 0);
  const lastScrapedTs = lastScrapeRow[0]?.ts ?? null;
  const lastScrapedLabel = lastScrapedTs ? `${relativeDate(lastScrapedTs)} ago` : null;

  return (
    <div className="dashboard-root flex h-screen flex-col bg-[color:var(--bg)]">
      <Topbar lastScraped={lastScrapedLabel} />
      <Settings
        initialProfile={profile}
        initialHardFilters={hardFilters}
        initialCompanies={companies}
        jobsTotal={jobsTotal}
        lastScrapedLabel={lastScrapedLabel}
      />
      <div className="too-narrow">
        <div>
          <div className="mb-1 font-mono text-[color:var(--text-pri)]">job-agent</div>
          <div>Open on desktop · ≥1024px</div>
        </div>
      </div>
    </div>
  );
}
