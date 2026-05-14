"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";
import StatsBar from "./StatsBar";
import FilterBar from "./FilterBar";
import JobTable from "./JobTable";
import DetailPanel from "./DetailPanel";
import { DEFAULT_FILTERS, DEFAULT_SORT, type Filters, type Sort, type StatusValue } from "./types";
import { useKeyboardNav } from "./keyboard";
import Toast from "./Toast";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
  boardActiveCount: number;
  boardErrorNames: string[];
}

export default function Dashboard({ initialJobs, lastScraped, boardActiveCount, boardErrorNames }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const visibleIdsRef = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedId) ?? null, [jobs, selectedId]);

  const handleRefresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs?active=${showArchived ? "false" : "true"}&limit=2000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs as Job[]);
    } catch {
      setToast({ message: "Refresh failed", retry: () => void handleRefresh() });
    }
  }, [showArchived]);

  const setStatusFilter = useCallback((status: StatusValue | null) => {
    setFilters(prev => ({ ...prev, status }));
  }, []);

  const handleVisibleChange = useCallback((ids: string[]) => {
    visibleIdsRef.current = ids;
  }, []);

  const patchJob = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const prev = jobs.find(j => j.id === id);
    // optimistic
    setJobs(curr => curr.map(j => j.id === id ? { ...j, ...mapApiToJob(updates) } : j));
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (prev) setJobs(curr => curr.map(j => j.id === id ? prev : j));
      setToast({
        message: "Couldn't update job",
        retry: () => void patchJob(id, updates),
      });
    }
  }, [jobs]);

  const handleUpdateStatus = useCallback((status: StatusValue) => {
    if (!selectedId) return;
    patchJob(selectedId, { status });
  }, [selectedId, patchJob]);

  const handleUpdateNotes = useCallback((notes: string) => {
    if (!selectedId) return;
    patchJob(selectedId, { notes });
  }, [selectedId, patchJob]);

  useKeyboardNav({
    visibleIds: useCallback(() => visibleIdsRef.current, []),
    focusedId,
    setFocusedId,
    selectedId,
    setSelectedId,
    onChangeStatus: handleUpdateStatus,
    focusSearch: useCallback(() => searchRef.current?.focus(), []),
  });

  return (
    <>
      <div className="dashboard-root flex h-screen flex-col bg-[color:var(--bg)]">
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
        {selectedJob && (
          <DetailPanel
            key={selectedJob.id}
            job={selectedJob}
            onClose={() => setSelectedId(null)}
            onUpdateStatus={handleUpdateStatus}
            onUpdateNotes={handleUpdateNotes}
            notesTextareaRef={notesRef}
          />
        )}
        <Toast
          message={toast?.message ?? null}
          onRetry={toast?.retry}
          onDismiss={() => setToast(null)}
        />
      </div>
      <div className="too-narrow">
        <div>
          <div className="mb-1 font-mono text-[color:var(--text-pri)]">job-agent</div>
          <div>Open on desktop · ≥1024px</div>
        </div>
      </div>
    </>
  );
}

/** Map API snake_case keys back to camelCase Job columns for optimistic state. */
function mapApiToJob(updates: Record<string, unknown>): Partial<Job> {
  const out: Record<string, unknown> = {};
  if ("status" in updates) out.status = updates.status;
  if ("notes" in updates) out.notes = updates.notes;
  if ("applied_date" in updates) out.appliedDate = updates.applied_date ? new Date(updates.applied_date as string) : null;
  if ("is_active" in updates) out.isActive = updates.is_active;
  if ("tier" in updates) out.tier = updates.tier;
  if ("role_category" in updates) out.roleCategory = updates.role_category;
  return out as Partial<Job>;
}
