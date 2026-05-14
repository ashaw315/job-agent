"use client";

import { useMemo } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay } from "@/lib/format";
import type { StatusValue, Filters } from "./types";

interface StatsBarProps {
  jobs: Job[];
  filters: Filters;
  onSetStatusFilter: (status: StatusValue | null) => void;
  boardErrorCount: number;
  boardErrorNames: string[];
  boardActiveCount: number;
}

export default function StatsBar({ jobs, filters, onSetStatusFilter, boardErrorCount, boardErrorNames, boardActiveCount }: StatsBarProps) {
  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    let active = 0;
    let newToday = 0;
    let high = 0, med = 0, low = 0;
    const pipeline: Record<StatusValue, number> = { new: 0, interested: 0, applied: 0, interviewing: 0, passed: 0 };

    for (const j of jobs) {
      if (j.isActive) active++;
      const scrapedTs = j.dateScraped ? new Date(j.dateScraped).getTime() : 0;
      if (scrapedTs >= todayMs && j.status === "new") newToday++;

      const s = scoreDisplay(j).value;
      if (s >= 70) high++;
      else if (s >= 40) med++;
      else low++;

      if (j.status && j.status in pipeline) pipeline[j.status as StatusValue]++;
    }

    return { active, newToday, high, med, low, pipeline };
  }, [jobs]);

  return (
    <div className="grid h-16 grid-cols-[1fr_1fr_1fr_1.4fr_1fr] divide-x divide-[color:var(--border)] border-b border-[color:var(--border)]">
      <Cell label="Active">
        <span className="font-mono text-[22px] tabular-nums text-[color:var(--text-pri)]">{stats.active}</span>
      </Cell>
      <Cell label="New today">
        <span className="font-mono text-[22px] tabular-nums text-[color:var(--text-pri)]">{stats.newToday}</span>
      </Cell>
      <Cell label="Score (hi / md / lo)">
        <span className="font-mono text-[14px] tabular-nums text-[color:var(--text-pri)]">
          {stats.high} <span className="text-[color:var(--text-sec)]">·</span> {stats.med} <span className="text-[color:var(--text-sec)]">·</span> {stats.low}
        </span>
      </Cell>
      <Cell label="Pipeline">
        <div className="flex items-baseline gap-2 text-[12px]">
          {(["new", "interested", "applied", "interviewing"] as const).map((s, i) => {
            const isActive = filters.status === s;
            const short = ["new", "int", "app", "itw"][i];
            return (
              <button
                key={s}
                onClick={() => onSetStatusFilter(isActive ? null : s)}
                className={isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-pri)] hover:text-[color:var(--accent)]"}
              >
                <span className="text-[color:var(--text-sec)]">{short}</span>{" "}
                <span className="font-mono tabular-nums">{stats.pipeline[s]}</span>
              </button>
            );
          })}
        </div>
      </Cell>
      <Cell label="Boards">
        <span className="text-[12px]" title={boardErrorNames.length ? `Errors: ${boardErrorNames.join(", ")}` : undefined}>
          <span className="font-mono tabular-nums text-[color:var(--text-pri)]">{boardActiveCount}</span>{" "}
          <span className="text-[color:var(--text-sec)]">active</span>
          {boardErrorCount > 0 && (
            <>
              {" · "}
              <span className="font-mono tabular-nums text-[color:var(--danger)]">{boardErrorCount}</span>{" "}
              <span className="text-[color:var(--text-sec)]">error</span>
            </>
          )}
        </span>
      </Cell>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center px-4">
      <div>{children}</div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">{label}</div>
    </div>
  );
}
