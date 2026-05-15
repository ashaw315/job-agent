"use client";

import { useState, useRef } from "react";
import type { Job } from "@/lib/db/schema";
import { scoreDisplay } from "@/lib/format";
import { STATUS_VALUES, type StatusValue } from "./types";

interface DetailPanelProps {
  job: Job;
  onClose: () => void;
  onUpdateStatus: (status: StatusValue) => void;
  onUpdateNotes: (notes: string) => void;
  notesTextareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function DetailPanel({ job, onClose, onUpdateStatus, onUpdateNotes, notesTextareaRef }: DetailPanelProps) {
  const score = scoreDisplay(job);
  const [notes, setNotes] = useState(job.notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internalNotesRef = useRef<HTMLTextAreaElement>(null);
  const taRef = notesTextareaRef ?? internalNotesRef;
  const [showDescription, setShowDescription] = useState(false);

  // The parent passes key={job.id} on <DetailPanel>, so this component fully
  // remounts whenever the selected job changes (j/k flipping). useState initial
  // values therefore handle the per-job reset — no effect needed here.

  const handleNotesChange = (next: string) => {
    setNotes(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    debounceRef.current = setTimeout(async () => {
      try {
        onUpdateNotes(next);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("failed");
      }
    }, 800);
  };

  const subtitleParts = [
    job.companyDisplayName ?? job.companyName,
    job.location,
    job.salaryText,
  ].filter(Boolean);

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-[color:var(--bg-backdrop)]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-30 flex h-screen flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-panel)] shadow-[-8px_0_20px_rgba(0,0,0,0.5)]"
        style={{ width: "min(640px, 50vw)" }}
        role="dialog"
        aria-label="Job details"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-medium text-[color:var(--text-pri)]">{job.title}</h2>
              {job.sourceUrl && (
                <a
                  href={job.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[color:var(--text-sec)] hover:text-[color:var(--accent)]"
                  aria-label="Open job posting in new tab"
                >
                  ↗
                </a>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-[color:var(--text-sec)]">{subtitleParts.join(" · ")}</div>
            {job.source === "manual" && (
              <div className="mt-1 text-[10px] uppercase tracking-wider text-[color:var(--accent)]">
                Manually added
              </div>
            )}
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="font-mono text-[18px] tabular-nums text-[color:var(--text-pri)]">
                {score.value}
                <span className="text-[color:var(--text-sec)]">
                  {score.source === "ai" ? " / 100" : " (keyword)"}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
            >
              ×
            </button>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 border-b border-[color:var(--border)] px-4 py-2">
          <select
            value={job.status}
            onChange={e => onUpdateStatus(e.target.value as StatusValue)}
            className="rounded border border-[color:var(--border-strong)] bg-[color:var(--bg)] px-2 py-1 text-[11px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
          >
            {STATUS_VALUES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-[color:var(--text-tert)]">
            1 new · 2 int · 3 app · 4 itw · 5 pass
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {job.aiReasoning && (
            <section className="mb-4">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">Reasoning</div>
              <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--text-pri)]">
                {job.aiReasoning}
              </div>
            </section>
          )}

          {job.aiGreenFlags && (
            <section className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--green-bg)] px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--green)]">Green flags</div>
              <div className="text-[11px] leading-relaxed text-[color:var(--text-pri)]">{job.aiGreenFlags}</div>
            </section>
          )}

          {job.aiRedFlags && (
            <section className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--danger-bg)] px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--danger)]">Red flags</div>
              <div className="text-[11px] leading-relaxed text-[color:var(--text-pri)]">{job.aiRedFlags}</div>
            </section>
          )}

          {job.description && (
            <section className="mb-4">
              <button
                onClick={() => setShowDescription(s => !s)}
                className="text-[11px] text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
              >
                Description {showDescription ? "▾" : "▸"}
              </button>
              {showDescription && (
                <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2 text-[12px] text-[color:var(--text-pri)]">
                  {job.description}
                </div>
              )}
            </section>
          )}

          <section>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]">Notes</div>
            <textarea
              ref={taRef}
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              rows={6}
              className="w-full resize-y rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2 text-[12px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
            />
            <div className="mt-1 text-[10px] text-[color:var(--text-sec)]">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved"}
              {saveState === "failed" && <span className="text-[color:var(--danger)]">Save failed — retry</span>}
              {saveState === "idle" && " "}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
