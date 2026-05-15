"use client";

import { useState, useRef, useEffect } from "react";
import type { Job } from "@/lib/db/schema";

interface ApiSuccess {
  success: true;
  duplicate: boolean;
  job_id: string;
  title: string;
  company: string;
  keyword_score: number | null;
  ai_score: number | null;
  ai_reasoning: string | null;
  green_flags: string | null;
  red_flags: string | null;
}

interface ApiError {
  success: false;
  error: "invalid_url" | "unreachable" | "auth_gated" | "not_a_job" | "extraction_failed" | "internal";
}

type ApiResponse = ApiSuccess | ApiError;

interface UrlBarProps {
  onJobAdded: (job: Job) => void;
  onSelectJob: (jobId: string) => void;
  onToast: (toast: { message: string; tone?: "ok" | "error"; jobId?: string }) => void;
}

const ERROR_MESSAGES: Record<ApiError["error"], string> = {
  invalid_url: "That doesn't look like a URL",
  unreachable: "Couldn't reach that page",
  auth_gated: "This page requires login",
  not_a_job: "This doesn't look like a job posting",
  extraction_failed: "Found the page but couldn't extract the job details",
  internal: "Something went wrong — try again",
};

const LABEL_STAGES = [
  { delayMs: 0,    label: "Fetching…" },
  { delayMs: 3000, label: "Extracting…" },
  { delayMs: 9000, label: "Scoring…" },
];

export default function UrlBar({ onJobAdded, onSelectJob, onToast }: UrlBarProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      // clean up any pending timers on unmount
      for (const t of timersRef.current) clearTimeout(t);
    };
  }, []);

  const cycleLabels = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    LABEL_STAGES.forEach((s, i) => {
      const t = setTimeout(() => setStage(i), s.delayMs);
      timersRef.current.push(t);
    });
  };

  const stopCycling = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    setStage(0);
  };

  const handleSubmit = async () => {
    const url = value.trim();
    if (!url || busy) return;
    setBusy(true);
    cycleLabels();
    try {
      const res = await fetch("/api/jobs/score-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: ApiResponse = await res.json();

      if (!data.success) {
        onToast({ message: ERROR_MESSAGES[data.error], tone: "error" });
        // keep the URL in the input so the user can retry / adjust
        return;
      }

      const score = data.ai_score ?? data.keyword_score ?? 0;
      if (data.duplicate) {
        onToast({
          message: `Already tracking — ${data.title} @ ${data.company} (${score}/100)`,
          tone: "ok",
          jobId: data.job_id,
        });
      } else {
        onToast({
          message: `Scored: ${data.title} @ ${data.company} — ${score}/100`,
          tone: "ok",
          jobId: data.job_id,
        });
        // Push a minimal Job-shaped row into local state. The full row is read from the
        // server when the dashboard next refreshes; for now we synthesize what we know.
        // Note: this only fills fields the table renders; absent fields stay null.
        onJobAdded({
          id: data.job_id,
          externalId: null,
          source: "manual",
          sourceUrl: url,
          companyName: data.company,
          companyDisplayName: data.company,
          companySize: null,
          title: data.title,
          description: null,
          location: null,
          salaryMin: null,
          salaryMax: null,
          salaryText: null,
          remotePolicy: null,
          tier: null,
          roleCategory: null,
          keywordScore: data.keyword_score,
          aiScore: data.ai_score,
          aiReasoning: data.ai_reasoning,
          aiGreenFlags: data.green_flags,
          aiRedFlags: data.red_flags,
          aiScoredAt: new Date(),
          status: "new",
          appliedDate: null,
          notes: null,
          datePosted: null,
          dateScraped: new Date(),
          isActive: true,
        });
      }
      setValue("");  // clear input on success
      // Surface the new/duplicate row in the table
      onSelectJob(data.job_id);
    } catch {
      onToast({ message: ERROR_MESSAGES.internal, tone: "error" });
    } finally {
      stopCycling();
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void handleSubmit();
  };

  const buttonLabel = busy ? LABEL_STAGES[stage].label : "Score it";

  return (
    <div className="flex h-11 items-center gap-2 border-b border-[color:var(--border)] px-4">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        placeholder="Paste any job URL — Greenhouse, Lever, Ashby, or any HTML page"
        className="flex-1 border-b border-[color:var(--border)] bg-transparent px-2 py-1 text-[12px] text-[color:var(--text-pri)] placeholder-[color:var(--text-tert)] focus:border-[color:var(--accent)] focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={busy || value.trim().length === 0}
        className="rounded border border-[color:var(--accent)] px-3 py-1 text-[11px] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)] disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
