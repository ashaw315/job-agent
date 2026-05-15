"use client";

import { useState } from "react";
import Toast from "@/components/dashboard/Toast";
import type { NotificationPrefs, NotificationFrequency } from "@/lib/settings/notifications";

interface NotificationsTabProps {
  initialNotifications: NotificationPrefs;
}

const FREQUENCIES: { value: NotificationFrequency; label: string; help: string }[] = [
  { value: "daily", label: "Daily", help: "Send every morning after the scrape." },
  { value: "weekdays", label: "Weekdays", help: "Send Monday through Friday only (UTC)." },
  { value: "manual", label: "Manual only", help: "Never send automatically. Use the test button below to send on demand." },
];

export default function NotificationsTab({ initialNotifications }: NotificationsTabProps) {
  const [value, setValue] = useState<NotificationPrefs>(initialNotifications);
  const [loaded, setLoaded] = useState<NotificationPrefs>(initialNotifications);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);

  const isDirty = JSON.stringify(value) !== JSON.stringify(loaded);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
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

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/digest/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value.email || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const msg = data.error || `HTTP ${res.status}`;
        setToast({ message: `Test failed: ${msg}` });
        return;
      }
      setToast({ message: `Test digest sent to ${data.sentTo} (${data.newToday} new today)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setToast({ message: `Test failed: ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-md space-y-5">
        <Field label="Email">
          <input
            type="email"
            value={value.email}
            onChange={e => setValue(v => ({ ...v, email: e.target.value }))}
            placeholder="you@example.com"
            className="w-full rounded border border-[color:var(--border-strong)] bg-[color:var(--bg)] px-2 py-1 text-[12px] text-[color:var(--text-pri)] focus:border-[color:var(--accent)] focus:outline-none"
          />
          <div className="mt-1 text-[10px] text-[color:var(--text-tert)]">
            Falls back to NOTIFICATION_EMAIL env var if blank.
          </div>
        </Field>

        <Field label="Frequency">
          <div className="flex flex-col gap-2">
            {FREQUENCIES.map(f => (
              <label key={f.value} className="flex cursor-pointer items-start gap-2 text-[12px] text-[color:var(--text-pri)]">
                <input
                  type="radio"
                  name="frequency"
                  value={f.value}
                  checked={value.frequency === f.value}
                  onChange={() => setValue(v => ({ ...v, frequency: f.value }))}
                  className="mt-0.5 accent-[color:var(--accent)]"
                />
                <span>
                  {f.label}
                  <div className="text-[10px] text-[color:var(--text-tert)]">{f.help}</div>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Paused">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[color:var(--text-pri)]">
            <input
              type="checkbox"
              checked={value.paused}
              onChange={e => setValue(v => ({ ...v, paused: e.target.checked }))}
              className="accent-[color:var(--accent)]"
            />
            Pause all automatic digests
          </label>
          <div className="mt-1 text-[10px] text-[color:var(--text-tert)]">
            When paused, no digests send regardless of frequency. The test button still works.
          </div>
        </Field>

        <div className="mt-6 flex items-center justify-end gap-3">
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

        <div className="mt-8 border-t border-[color:var(--border)] pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-[color:var(--text-sec)]">Test</div>
          <div className="mb-3 text-[11px] text-[color:var(--text-sec)]">
            Build and send today&apos;s digest now, bypassing all gates (paused, frequency). Uses the email above (or the env fallback).
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-[11px] text-[color:var(--text-pri)] hover:bg-[color:var(--bg-row-hover)] disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send test digest"}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[color:var(--text-sec)]">{label}</div>
      {children}
    </div>
  );
}
