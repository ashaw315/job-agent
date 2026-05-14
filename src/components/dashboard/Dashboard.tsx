"use client";

import { useState, useCallback } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import { DEFAULT_FILTERS, type Filters, type StatusValue } from "./types";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const handleRefresh = useCallback(async () => {
    const res = await fetch("/api/jobs?active=true&limit=2000");
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, []);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <StatsBar
        jobs={jobs}
        filters={filters}
        onSetStatusFilter={setStatusFilter}
        boardActiveCount={boardActiveCount}
        boardErrorCount={boardErrorNames.length}
        boardErrorNames={boardErrorNames}
      />
      <main className="flex-1 p-4 text-[color:var(--text-sec)]">
        Filter status: {filters.status ?? "all"} · {jobs.length} jobs · table comes next
      </main>
    </div>
  );
}
