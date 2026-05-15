"use client";

import { useState } from "react";
import Toast from "@/components/dashboard/Toast";

interface ProfileTabProps {
  initialProfile: string;
  jobsTotal: number;
}

type SaveState = "idle" | "saving" | "confirming";

export default function ProfileTab({ initialProfile, jobsTotal }: ProfileTabProps) {
  const [value, setValue] = useState(initialProfile);
  const [loadedValue, setLoadedValue] = useState(initialProfile);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [rescoreConfirming, setRescoreConfirming] = useState(false);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);

  const isDirty = value !== loadedValue;

  const putProfile = async () => {
    const res = await fetch("/api/settings/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`PUT failed: HTTP ${res.status}`);
  };

  const handleSave = async () => {
    setSaveState("saving");
    try {
      await putProfile();
      setLoadedValue(value);
      setToast({ message: "Saved" });
    } catch {
      setToast({ message: "Save failed — retry", retry: () => void handleSave() });
    } finally {
      setSaveState("idle");
    }
  };

  const handleSaveAndRescore = async () => {
    if (!rescoreConfirming) {
      setRescoreConfirming(true);
      setTimeout(() => setRescoreConfirming(false), 5000);
      return;
    }
    setRescoreConfirming(false);
    setSaveState("saving");
    try {
      await putProfile();
      setLoadedValue(value);
      try {
        const res = await fetch("/api/jobs/reset-scores", { method: "POST" });
        if (!res.ok) throw new Error(`reset HTTP ${res.status}`);
        const data = await res.json();
        setToast({ message: `Saved · reset ${data.count} jobs` });
      } catch {
        setToast({
          message: "Profile saved but score reset failed — retry",
          retry: async () => {
            const res = await fetch("/api/jobs/reset-scores", { method: "POST" });
            if (res.ok) {
              const data = await res.json();
              setToast({ message: `Reset ${data.count} jobs` });
            } else {
              setToast({ message: "Reset failed again", retry: undefined });
            }
          },
        });
      }
    } catch {
      setToast({ message: "Save failed — retry", retry: () => void handleSaveAndRescore() });
    } finally {
      setSaveState("idle");
    }
  };

  return (
    <div className="p-6">
      <div className="mb-2 text-[12px] text-[color:var(--text-sec)]">
        Candidate profile shown to the AI scorer. Plain text bullet list works best.
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={15}
        className="w-full rounded border border-[color:var(--border)] bg-[color:var(--bg-panel)] p-3 text-[12px] leading-relaxed text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={handleSave}
          disabled={saveState === "saving" || !isDirty}
          className={
            "rounded border px-3 py-1 text-[11px] " +
            (isDirty
              ? "border-[color:var(--border-strong)] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]"
              : "border-[color:var(--border)] text-[color:var(--text-tert)] cursor-not-allowed")
          }
        >
          {saveState === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleSaveAndRescore}
          disabled={saveState === "saving"}
          className={
            "rounded border px-3 py-1 text-[11px] " +
            (rescoreConfirming
              ? "border-[color:var(--danger)] text-[color:var(--danger)]"
              : "border-[color:var(--border-strong)] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]")
          }
        >
          {rescoreConfirming
            ? `Confirm: re-score all ${jobsTotal} jobs?`
            : "Save & re-score all"}
        </button>
      </div>
      <Toast
        message={toast?.message ?? null}
        onRetry={toast?.retry}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
