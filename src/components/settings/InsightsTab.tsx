"use client";

import { useState } from "react";
import Toast from "@/components/dashboard/Toast";
import DangerAction from "./DangerAction";
import { relativeDate } from "@/lib/format";
import type { InsightsContent } from "@/lib/insights/analyze";

interface InsightsTabProps {
  initialInsights: InsightsContent | null;
}

export default function InsightsTab({ initialInsights }: InsightsTabProps) {
  const [insights, setInsights] = useState<InsightsContent | null>(initialInsights);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);

  const handleRefresh = async () => {
    try {
      const res = await fetch("/api/insights/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const msg = data.error || `HTTP ${res.status}`;
        setToast({ message: `Refresh failed: ${msg}` });
        return;
      }
      setInsights({ lastRefreshedAt: data.lastRefreshedAt, content: data.content });
      setToast({ message: "Insights refreshed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setToast({ message: `Refresh failed: ${msg}` });
    }
  };

  const refreshedLabel = insights
    ? `Last refreshed ${relativeDate(insights.lastRefreshedAt)} ago`
    : null;

  return (
    <div className="p-6">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] text-[color:var(--text-sec)]">
            Identifies skills and experience that appear repeatedly in your 40–65 score jobs
            but that you lack. For each gap, classifies it as reframable (your existing
            experience can address it) or a real gap (needs new development).
          </div>
          {refreshedLabel && (
            <div className="mt-2 text-[10px] uppercase tracking-wider text-[color:var(--text-tert)]">
              {refreshedLabel}
            </div>
          )}
        </div>
      </div>

      {/* Refresh action — uses the two-click reveal because each refresh costs Claude tokens. */}
      <div className="mb-6">
        <DangerAction
          label="Refresh insights"
          description={`Calls Claude with your profile and up to 15 stretch-range jobs.\nCosts ~$0.10–$0.30 per refresh. Cached result is overwritten.`}
          confirmText="Confirm: refresh insights?"
          buttonText="Refresh"
          onAction={handleRefresh}
        />
      </div>

      {/* Cached content or empty state */}
      {insights ? (
        <div className="rounded border border-[color:var(--border)] bg-[color:var(--bg-panel)] p-4">
          <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-[color:var(--text-pri)]">
            {insights.content}
          </pre>
        </div>
      ) : (
        <div className="rounded border border-[color:var(--border)] bg-[color:var(--bg-panel)] px-4 py-16 text-center text-[12px] text-[color:var(--text-sec)]">
          No insights computed yet. Click Refresh to analyze your stretch-range jobs.
        </div>
      )}

      <Toast
        message={toast?.message ?? null}
        onRetry={toast?.retry}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
