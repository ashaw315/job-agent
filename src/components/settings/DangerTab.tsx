"use client";

import { useState } from "react";
import DangerAction from "./DangerAction";
import Toast from "@/components/dashboard/Toast";

interface DangerTabProps {
  jobsTotal: number;
}

export default function DangerTab({ jobsTotal }: DangerTabProps) {
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);
  const [activeCount, setActiveCount] = useState(jobsTotal);

  const handleReset = async () => {
    try {
      const res = await fetch("/api/jobs/reset-scores", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setToast({ message: `Reset ${data.count} jobs.` });
    } catch {
      setToast({ message: "Reset failed — retry", retry: () => void handleReset() });
    }
  };

  const handleArchive = async () => {
    try {
      const res = await fetch("/api/jobs/archive-all", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActiveCount(0);
      setToast({ message: `Archived ${data.count} jobs.` });
    } catch {
      setToast({ message: "Archive failed — retry", retry: () => void handleArchive() });
    }
  };

  const handleExport = async () => {
    // Browser handles the download via Content-Disposition. Easiest path:
    // create an <a download> click programmatically. window.location.assign also works.
    window.location.assign("/api/jobs/export");
  };

  return (
    <div className="p-6">
      <div className="rounded border border-[color:rgba(196,126,126,0.3)] bg-[color:rgba(196,126,126,0.04)] p-4">
        <div className="mb-2 text-[12px] text-[color:var(--danger)] font-medium">
          ! Danger Zone — these actions are destructive and not always reversible.
        </div>
        <DangerAction
          label="Reset all AI scores"
          description={`Nulls ai_scored_at on all jobs so the next scrape re-scores them.\nAffects ${jobsTotal} jobs · re-running AI scoring costs API tokens.`}
          confirmText={`Confirm: reset ${jobsTotal} jobs?`}
          buttonText="Reset"
          onAction={handleReset}
        />
        <DangerAction
          label="Archive all jobs"
          description={`Sets status='passed' and is_active=false on every job. Use to clear the dashboard for a fresh start.\nAffects ${activeCount} jobs. Notes/status are overwritten.`}
          confirmText={`Confirm: archive ${activeCount} jobs?`}
          buttonText="Archive"
          onAction={handleArchive}
        />
        <DangerAction
          label="Export jobs as CSV"
          description={`Downloads the full jobs table (${jobsTotal} rows) with all columns.`}
          confirmText=""
          buttonText="Download"
          noConfirm
          onAction={handleExport}
        />
      </div>
      <Toast
        message={toast?.message ?? null}
        onRetry={toast?.retry}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
