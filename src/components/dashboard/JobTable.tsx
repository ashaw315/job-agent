"use client";

import { useMemo, useEffect, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay, relativeDate, tierColor } from "@/lib/format";
import type { Filters, Sort, SortField, StatusValue } from "./types";
import { SOURCE_CATEGORY_SLUGS } from "./types";

interface JobTableProps {
  jobs: Job[];
  filters: Filters;
  showArchived: boolean;
  sort: Sort;
  onSortChange: (next: Sort) => void;
  focusedId: string | null;
  selectedId: string | null;
  onFocus: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Expose the filtered+sorted list to the parent so keyboard nav can act on it. */
  onVisibleChange: (ids: string[]) => void;
}

const STATUS_LABEL: Record<StatusValue, string> = {
  new: "new",
  interested: "int",
  applied: "app",
  interviewing: "itw",
  passed: "—",
};

export default function JobTable({
  jobs, filters, showArchived, sort, onSortChange,
  focusedId, selectedId, onFocus, onSelect, onVisibleChange,
}: JobTableProps) {
  const visible = useMemo(() => {
    const searchLower = filters.search.trim().toLowerCase();
    const filtered = jobs.filter(j => {
      if (!showArchived && !j.isActive) return false;
      if (filters.status && j.status !== filters.status) return false;
      if (filters.tier !== null && j.tier !== filters.tier) return false;
      if (filters.minScore > 0 && scoreDisplay(j).value < filters.minScore) return false;
      if (filters.sourceCategory !== null) {
        const allowed = SOURCE_CATEGORY_SLUGS[filters.sourceCategory];
        if (!allowed.includes(j.source)) return false;
      }
      if (searchLower) {
        const hay = `${j.title} ${j.companyDisplayName ?? j.companyName ?? ""}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => cmp(a, b, sort));
    return sorted;
  }, [jobs, filters, showArchived, sort]);

  // Tell parent what's visible (for keyboard nav)
  useEffect(() => {
    onVisibleChange(visible.map(j => j.id));
  }, [visible, onVisibleChange]);

  // Auto-scroll focused row into view
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (!focusedId) return;
    const el = rowRefs.current.get(focusedId);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  if (visible.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[color:var(--text-sec)] text-[12px]">
        {jobs.length === 0
          ? "No jobs yet. Run /api/cron/scrape to populate."
          : "No matches · clear filters"}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid w-full sticky top-0 z-10 bg-[color:var(--bg-hdr)] border-b border-[color:var(--border)]"
           style={{ gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 50px 40px 80px 50px" }}>
        <HeaderCell label="Title" field="title" sort={sort} onSort={onSortChange} />
        <HeaderCell label="Company" field="company" sort={sort} onSort={onSortChange} />
        <HeaderCell label="Location" field={null} />
        <HeaderCell label="Score" field="score" sort={sort} onSort={onSortChange} align="right" />
        <HeaderCell label="T" field={null} align="right" />
        <HeaderCell label="Status" field={null} />
        <HeaderCell label="Date" field="date" sort={sort} onSort={onSortChange} align="right" />
      </div>

      <div>
        {visible.map(job => {
          const s = scoreDisplay(job);
          const isFocused = focusedId === job.id;
          const isSelected = selectedId === job.id;
          return (
            <div
              key={job.id}
              ref={el => { if (el) rowRefs.current.set(job.id, el); else rowRefs.current.delete(job.id); }}
              onMouseEnter={() => onFocus(job.id)}
              onClick={() => onSelect(job.id)}
              className={
                "grid h-7 cursor-pointer items-center border-b border-[color:var(--border)] text-[12px] " +
                (isSelected
                  ? "bg-[color:var(--bg-row-sel)]"
                  : isFocused
                    ? "bg-[color:var(--bg-row-hover)]"
                    : "hover:bg-[color:var(--bg-row-hover)]") +
                (job.isActive ? "" : " opacity-60") +
                (isFocused || isSelected ? " border-l-2 border-l-[color:var(--accent)]" : " border-l-2 border-l-transparent")
              }
              style={{ gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 50px 40px 80px 50px" }}
            >
              <div className="truncate px-2.5">{job.title}</div>
              <div className="truncate px-2.5 text-[color:var(--text-sec)]">
                {job.companyDisplayName ?? job.companyName}
                {job.source === "manual" && (
                  <span className="ml-1.5 font-mono text-[9px] text-[color:var(--accent)]" title="Manually added">·M·</span>
                )}
              </div>
              <div className="truncate px-2.5 text-[color:var(--text-sec)]">{job.location || "—"}</div>
              <div className={"px-2.5 text-right font-mono text-[11px] tabular-nums " + (s.source === "ai" ? "text-[color:var(--text-pri)]" : "text-[color:var(--text-sec)]")}>
                {s.value}
              </div>
              <div className="px-2.5 text-right font-mono text-[11px] tabular-nums" style={{ color: tierColor(job.tier) }}>
                {job.tier ?? "—"}
              </div>
              <div className="px-2.5">
                <StatusPill status={job.status as StatusValue} />
              </div>
              <div className="px-2.5 text-right font-mono text-[11px] tabular-nums text-[color:var(--text-sec)]">
                {relativeDate(job.dateScraped)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeaderCell({ label, field, sort, onSort, align }: { label: string; field: SortField | null; sort?: Sort; onSort?: (s: Sort) => void; align?: "right" }) {
  const isActive = field !== null && sort?.field === field;
  const handleClick = () => {
    if (!field || !onSort) return;
    if (!sort) return;
    onSort({ field, dir: isActive ? (sort.dir === "asc" ? "desc" : "asc") : "desc" });
  };
  return (
    <div
      onClick={handleClick}
      className={
        "px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[color:var(--text-sec)] " +
        (align === "right" ? "text-right " : "") +
        (field ? "cursor-pointer hover:text-[color:var(--text-pri)] " : "")
      }
    >
      {label}
      {isActive && sort && (
        <span className="ml-1 text-[color:var(--accent)]">{sort.dir === "asc" ? "▴" : "▾"}</span>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: StatusValue }) {
  if (status === "passed") return <span className="text-[color:var(--text-sec)]">—</span>;
  const base = "inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-medium";
  const styles: Record<Exclude<StatusValue, "passed">, string> = {
    new: "bg-[color:var(--accent-bg)] text-[color:var(--accent)]",
    interested: "border border-[color:var(--border-strong)] text-[color:var(--text-pri)]",
    applied: "border border-[color:var(--border-strong)] text-[color:var(--text-sec)]",
    interviewing: "bg-[color:var(--accent)] text-[color:var(--bg)]",
  };
  return <span className={`${base} ${styles[status as Exclude<StatusValue, "passed">]}`}>{STATUS_LABEL[status]}</span>;
}

function cmp(a: Job, b: Job, sort: Sort): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  switch (sort.field) {
    case "score": {
      return (scoreDisplay(a).value - scoreDisplay(b).value) * dir;
    }
    case "title":
      return a.title.localeCompare(b.title) * dir;
    case "company":
      return (a.companyDisplayName ?? a.companyName ?? "").localeCompare(b.companyDisplayName ?? b.companyName ?? "") * dir;
    case "date": {
      const at = a.dateScraped ? new Date(a.dateScraped).getTime() : 0;
      const bt = b.dateScraped ? new Date(b.dateScraped).getTime() : 0;
      return (at - bt) * dir;
    }
  }
}
