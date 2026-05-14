"use client";

import type { Job } from "@/lib/db/schema";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
}

export default function Dashboard({ initialJobs, lastScraped }: DashboardProps) {
  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-[color:var(--border)] px-4 py-2 text-[11px]">
        <span className="text-[color:var(--text-sec)]">job-agent</span>
        <span className="float-right text-[color:var(--text-sec)]">
          {lastScraped ? `Last scraped ${lastScraped}` : "Never scraped"}
        </span>
      </div>
      <div className="flex-1 p-4 text-[color:var(--text-sec)]">
        {initialJobs.length} jobs loaded (dashboard chrome coming in next tasks)
      </div>
    </div>
  );
}
