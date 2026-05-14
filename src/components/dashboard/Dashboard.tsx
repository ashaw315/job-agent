"use client";

import { useState, useCallback, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
import JobTable from "./JobTable";
import { DEFAULT_FILTERS, DEFAULT_SORT, type Filters, type Sort, type StatusValue } from "./types";

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
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
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

  const handleVisibleChange = useCallback((ids: string[]) => {
    visibleIdsRef.current = ids;
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[color:var(--bg)]">
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
      <JobTable
        jobs={jobs}
        filters={filters}
        showArchived={showArchived}
        sort={sort}
        onSortChange={setSort}
        focusedId={focusedId}
        selectedId={selectedId}
        onFocus={setFocusedId}
        onSelect={setSelectedId}
        onVisibleChange={handleVisibleChange}
      />
    </div>
  );
}
