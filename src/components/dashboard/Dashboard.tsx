"use client";

import { useState, useCallback, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
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
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleRefresh = useCallback(async () => {
    const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
    if (!res.ok) return;
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, [showArchived]);

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
      <FilterBar
        ref={searchRef}
        filters={filters}
        showArchived={showArchived}
        onChange={setFilters}
        onToggleArchived={setShowArchived}
      />
      <main className="flex-1 p-4 text-[color:var(--text-sec)] text-[11px]">
        Filters: {JSON.stringify({ ...filters, showArchived })} · {jobs.length} jobs · table comes next
      </main>
    </div>
  );
}
