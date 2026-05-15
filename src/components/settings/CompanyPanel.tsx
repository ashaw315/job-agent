"use client";

import { useState } from "react";
import type { WatchedCompany } from "@/lib/db/schema";
import { relativeDate } from "@/lib/format";

const ATS_VALUES = ["greenhouse", "lever", "ashby", "custom"] as const;
const CATEGORY_VALUES = [
  "art_world", "design_forward", "ai", "studio",
  "brand", "tech", "startup", "museum", "media",
] as const;
const CUSTOM_SCRAPER_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "builtinnyc", label: "BuiltInNYC" },
  { value: "weworkremotely", label: "We Work Remotely" },
  { value: "whitney", label: "Whitney" },
  { value: "awwwards", label: "Awwwards" },
  { value: "creativeapplications", label: "CreativeApplications" },
  { value: "dribbble", label: "Dribbble" },
  { value: "mediabistro", label: "Mediabistro" },
] as const;

interface FormState {
  name: string;
  ats: string;
  boardUrl: string;
  customScraper: string;
  category: string;
  priority: number;
  isActive: boolean;
}

interface CompanyPanelProps {
  /** If null, panel is in "add" mode. Otherwise edit mode. */
  company: WatchedCompany | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CompanyPanel({ company, onClose, onSaved }: CompanyPanelProps) {
  const isAdd = company === null;
  const [form, setForm] = useState<FormState>(() => ({
    name: company?.name ?? "",
    ats: company?.ats ?? "greenhouse",
    boardUrl: company?.boardUrl ?? "",
    customScraper: company?.customScraper ?? "",
    category: company?.category ?? "tech",
    priority: company?.priority ?? 2,
    isActive: company?.isActive ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isAdd) {
        const res = await fetch("/api/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            ats: form.ats,
            board_url: form.boardUrl,
            custom_scraper: form.customScraper || null,
            category: form.category,
            priority: form.priority,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
      } else {
        const res = await fetch("/api/companies", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: company!.id,
            updates: {
              name: form.name,
              ats: form.ats,
              board_url: form.boardUrl,
              custom_scraper: form.customScraper || null,
              category: form.category,
              priority: form.priority,
              is_active: form.isActive,
            },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirming) {
      setDeleteConfirming(true);
      setTimeout(() => setDeleteConfirming(false), 5000);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: company!.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
      setDeleteConfirming(false);
    }
  };

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
        aria-label={isAdd ? "Add company" : `Edit ${company?.name}`}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
          <h2 className="text-[15px] font-medium text-[color:var(--text-pri)]">
            {isAdd ? "Add company" : `Edit ${company?.name}`}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="input w-full"
            />
          </Field>
          <Field label="ATS">
            <select
              value={form.ats}
              onChange={e => setForm({ ...form, ats: e.target.value })}
              className="input"
            >
              {ATS_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          {form.ats === "custom" && (
            <Field label="Custom scraper">
              <select
                value={form.customScraper}
                onChange={e => setForm({ ...form, customScraper: e.target.value })}
                className="input"
              >
                {CUSTOM_SCRAPER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Board URL">
            <input
              type="text"
              value={form.boardUrl}
              onChange={e => setForm({ ...form, boardUrl: e.target.value })}
              className="input w-full"
            />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              className="input"
            >
              {CATEGORY_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <input
              type="number"
              min={1}
              max={3}
              value={form.priority}
              onChange={e => setForm({ ...form, priority: Math.max(1, Math.min(3, Number(e.target.value) || 2)) })}
              className="input w-16 font-mono"
            />
          </Field>
          {!isAdd && (
            <Field label="Active">
              <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-pri)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={e => setForm({ ...form, isActive: e.target.checked })}
                  className="accent-[color:var(--accent)]"
                />
                Active
              </label>
            </Field>
          )}
          {!isAdd && (
            <div className="mt-2 border-t border-[color:var(--border)] pt-3 text-[10px] text-[color:var(--text-sec)]">
              <div>Last scraped: {company!.lastScraped ? `${relativeDate(company!.lastScraped)} ago` : "never"}</div>
              {company!.lastError && (
                <div className="mt-1 text-[color:var(--danger)]">Last error: {company!.lastError}</div>
              )}
            </div>
          )}
          {error && (
            <div className="text-[11px] text-[color:var(--danger)]">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[color:var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-[11px] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={onClose}
              className="text-[11px] text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
            >
              Cancel
            </button>
          </div>
          {!isAdd && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className={
                "rounded border px-3 py-1 text-[11px] " +
                (deleteConfirming
                  ? "border-[color:var(--danger)] text-[color:var(--danger)]"
                  : "border-transparent text-[color:var(--danger)] hover:border-[color:var(--danger)]")
              }
            >
              {deleteConfirming ? `Confirm: delete ${company?.name}?` : "Delete"}
            </button>
          )}
        </div>
      </aside>
      <style jsx>{`
        .input {
          background: var(--bg);
          color: var(--text-pri);
          border: 1px solid var(--border-strong);
          border-radius: 3px;
          padding: 4px 8px;
          font-size: 12px;
        }
        .input:focus { outline: none; border-color: var(--accent); }
      `}</style>
    </>
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
