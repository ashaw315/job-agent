"use client";

import { useState } from "react";
import Toast from "@/components/dashboard/Toast";
import type { HardFilters } from "@/lib/settings/hard-filters";

interface FiltersTabProps {
  initialHardFilters: HardFilters;
}

export default function FiltersTab({ initialHardFilters }: FiltersTabProps) {
  const [value, setValue] = useState<HardFilters>(initialHardFilters);
  const [loaded, setLoaded] = useState<HardFilters>(initialHardFilters);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);

  const isDirty = JSON.stringify(value) !== JSON.stringify(loaded);

  const toggleEmpType = (et: "full_time" | "temp_to_perm") => {
    setValue(v => ({
      ...v,
      employmentTypes: v.employmentTypes.includes(et)
        ? v.employmentTypes.filter(t => t !== et)
        : [...v.employmentTypes, et],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/hard_filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(value) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLoaded(value);
      setToast({ message: "Saved" });
    } catch {
      setToast({ message: "Save failed — retry", retry: () => void handleSave() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-md space-y-5">
        <Field label="Location">
          <select
            value={value.location}
            onChange={e => setValue(v => ({ ...v, location: e.target.value as HardFilters["location"] }))}
            className="w-full rounded border border-[color:var(--border-strong)] bg-[color:var(--bg)] px-2 py-1 text-[12px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
          >
            <option value="nyc_only">NYC only</option>
            <option value="remote_only">Remote only</option>
            <option value="nyc_remote">NYC + Remote</option>
            <option value="all">All</option>
          </select>
        </Field>

        <Field label="Salary floor" help="Jobs with a stated max salary below this are auto-archived. Jobs without listed salary are not filtered.">
          <input
            type="number"
            min={0}
            max={500000}
            value={value.salaryFloor}
            onChange={e => setValue(v => ({ ...v, salaryFloor: Math.max(0, Math.min(500000, Number(e.target.value) || 0)) }))}
            className="w-32 rounded border border-[color:var(--border-strong)] bg-[color:var(--bg)] px-2 py-1 font-mono text-[12px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </Field>

        <Field label="Employment type" help="Temp/contract: when unchecked, excludes jobs mentioning contract, 1099, freelance, or temp-to-perm in title or description.">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-pri)] cursor-pointer">
              <input
                type="checkbox"
                checked={value.employmentTypes.includes("full_time")}
                onChange={() => toggleEmpType("full_time")}
                className="accent-[color:var(--accent)]"
              />
              Full-time
            </label>
            <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-pri)] cursor-pointer">
              <input
                type="checkbox"
                checked={value.employmentTypes.includes("temp_to_perm")}
                onChange={() => toggleEmpType("temp_to_perm")}
                className="accent-[color:var(--accent)]"
              />
              Temp-to-perm
            </label>
          </div>
        </Field>

        <div className="mt-6 flex items-center justify-end gap-3">
          <span className="italic text-[10px] text-[color:var(--text-tert)]">
            Changes apply to jobs scraped from now on. Existing jobs are unaffected.
          </span>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={
              "rounded border px-3 py-1 text-[11px] " +
              (isDirty
                ? "border-[color:var(--border-strong)] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]"
                : "border-[color:var(--border)] text-[color:var(--text-tert)] cursor-not-allowed")
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <Toast
        message={toast?.message ?? null}
        onRetry={toast?.retry}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[color:var(--text-sec)]">{label}</div>
      {children}
      {help && <div className="mt-1 text-[10px] text-[color:var(--text-tert)]">{help}</div>}
    </div>
  );
}
