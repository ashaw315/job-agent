"use client";

import { forwardRef } from "react";
import type { Filters, StatusValue, SourceCategory } from "./types";

interface FilterBarProps {
  filters: Filters;
  showArchived: boolean;
  onChange: (next: Filters) => void;
  onToggleArchived: (next: boolean) => void;
}

const STATUS_CHIPS: { value: StatusValue | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "new", label: "New" },
  { value: "interested", label: "Interested" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
];

const TIER_CHIPS: { value: 1 | 2 | 3 | null; label: string }[] = [
  { value: 1, label: "T1" },
  { value: 2, label: "T2" },
  { value: 3, label: "T3" },
];

const SOURCE_CHIPS: { value: SourceCategory | null; label: string }[] = [
  { value: null, label: "All sources" },
  { value: "boards", label: "Boards" },
  { value: "aggregators", label: "Aggregators" },
  { value: "manual", label: "Manual" },
];

const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar(
  { filters, showArchived, onChange, onToggleArchived },
  searchRef
) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-[color:var(--border)] px-4 text-[11px]">
      {/* Status chips */}
      <div className="flex items-center gap-3">
        {STATUS_CHIPS.map(c => {
          const isActive = filters.status === c.value;
          return (
            <button
              key={c.label}
              onClick={() => onChange({ ...filters, status: c.value })}
              className={
                "border-b py-1 transition-colors " +
                (isActive
                  ? "border-[color:var(--accent)] text-[color:var(--text-pri)]"
                  : "border-transparent text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-3 w-px bg-[color:var(--border)]" />

      {/* Tier chips */}
      <div className="flex items-center gap-2">
        {TIER_CHIPS.map(c => {
          const isActive = filters.tier === c.value;
          return (
            <button
              key={c.label}
              onClick={() => onChange({ ...filters, tier: isActive ? null : c.value })}
              className={
                "rounded px-1.5 py-0.5 font-mono text-[10px] " +
                (isActive
                  ? "bg-[color:var(--accent-bg)] text-[color:var(--accent)]"
                  : "text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-3 w-px bg-[color:var(--border)]" />

      {/* Source category chips */}
      <div className="flex items-center gap-3">
        {SOURCE_CHIPS.map(c => {
          const isActive = filters.sourceCategory === c.value;
          return (
            <button
              key={c.label}
              onClick={() => onChange({ ...filters, sourceCategory: c.value })}
              className={
                "border-b py-1 transition-colors " +
                (isActive
                  ? "border-[color:var(--accent)] text-[color:var(--text-pri)]"
                  : "border-transparent text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-3 w-px bg-[color:var(--border)]" />

      {/* Min score */}
      <label className="flex items-center gap-1 text-[color:var(--text-sec)]">
        Min score
        <input
          type="number"
          min={0}
          max={100}
          value={filters.minScore}
          onChange={e => onChange({ ...filters, minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          className="w-12 border-b border-[color:var(--border)] bg-transparent px-1 font-mono text-[11px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
        />
      </label>

      {/* Search */}
      <input
        ref={searchRef}
        type="text"
        placeholder="Search title or company…"
        value={filters.search}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        className="flex-1 border-b border-[color:var(--border)] bg-transparent px-2 py-1 text-[12px] text-[color:var(--text-pri)] placeholder-[color:var(--text-tert)] focus:border-[color:var(--accent)] focus:outline-none"
      />

      {/* Archived toggle */}
      <label className="flex cursor-pointer items-center gap-1.5 text-[color:var(--text-sec)]">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={e => onToggleArchived(e.target.checked)}
          className="accent-[color:var(--accent)]"
        />
        Archived
      </label>
    </div>
  );
});

export default FilterBar;
