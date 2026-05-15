"use client";

// TODO: pagination when company count > 50 (currently inlined scroll).

import { useState, useCallback } from "react";
import type { WatchedCompany } from "@/lib/db/schema";
import { relativeDate } from "@/lib/format";
import CompanyPanel from "./CompanyPanel";
import Toast from "@/components/dashboard/Toast";

interface CompaniesTabProps {
  initialCompanies: WatchedCompany[];
  initialLastScraped: string | null;
}

interface ScrapeSummary {
  total_companies_scraped: number;
  total_jobs_found: number;
  total_new_jobs: number;
  errors: string[];
  ai_scores_run: number;
}

export default function CompaniesTab({ initialCompanies, initialLastScraped }: CompaniesTabProps) {
  const [companies, setCompanies] = useState<WatchedCompany[]>(initialCompanies);
  const [lastScrapedLabel, setLastScrapedLabel] = useState(initialLastScraped);
  const [editing, setEditing] = useState<WatchedCompany | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeSummary | null>(null);
  const [errorsVisible, setErrorsVisible] = useState(false);
  const [toast, setToast] = useState<{ message: string; retry?: () => void } | null>(null);

  const activeCount = companies.filter(c => c.isActive).length;

  const refetch = useCallback(async () => {
    const res = await fetch("/api/companies");
    if (!res.ok) return;
    const data = await res.json();
    setCompanies(data.companies as WatchedCompany[]);
  }, []);

  const handleScrape = async () => {
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await fetch("/api/scrape", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const summary = (await res.json()) as ScrapeSummary;
      setScrapeResult(summary);
      setLastScrapedLabel("just now");
      await refetch();
      setTimeout(() => setScrapeResult(null), 10000);
    } catch {
      setToast({ message: "Scrape failed — retry", retry: () => void handleScrape() });
    } finally {
      setScraping(false);
    }
  };

  const openAdd = () => { setEditing(null); setPanelOpen(true); };
  const openEdit = (c: WatchedCompany) => { setEditing(c); setPanelOpen(true); };
  const closePanel = () => { setPanelOpen(false); setEditing(null); };
  const onSaved = () => { void refetch(); };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3 sticky top-0 z-10 bg-[color:var(--bg)] py-2">
        <div className="text-[13px] text-[color:var(--text-pri)]">
          Watched Companies
          <span className="ml-2 text-[color:var(--text-sec)]">· {activeCount} active</span>
          {lastScrapedLabel && (
            <span className="ml-2 text-[color:var(--text-sec)]">· last scraped {lastScrapedLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAdd}
            className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-[11px] text-[color:var(--text-pri)] hover:bg-[color:var(--bg-row-hover)]"
          >
            + add
          </button>
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="rounded border border-[color:var(--accent)] px-3 py-1 text-[11px] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)] disabled:opacity-50"
          >
            {scraping ? "Scraping…" : "Run scrape now"}
          </button>
        </div>
      </div>

      {scrapeResult && (
        <div className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--bg-panel)] px-3 py-2 text-[11px] text-[color:var(--text-pri)]">
          Scraped {scrapeResult.total_companies_scraped} companies ·{" "}
          <span className="font-mono">{scrapeResult.total_new_jobs}</span> new ·{" "}
          <span className="font-mono">{scrapeResult.ai_scores_run}</span> AI-scored
          {scrapeResult.errors.length > 0 && (
            <>
              {" · "}
              <button
                onClick={() => setErrorsVisible(v => !v)}
                className="text-[color:var(--danger)] underline"
              >
                {scrapeResult.errors.length} errors
              </button>
              {errorsVisible && (
                <ul className="mt-2 ml-4 list-disc text-[color:var(--text-sec)]">
                  {scrapeResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {companies.length === 0 ? (
        <div className="py-16 text-center text-[12px] text-[color:var(--text-sec)]">
          No companies. Add one with + add or run <code>/api/seed</code>.
        </div>
      ) : (
        <div className="rounded border border-[color:var(--border)]">
          <div
            className="grid bg-[color:var(--bg-hdr)] text-[9px] uppercase tracking-wider text-[color:var(--text-sec)]"
            style={{ gridTemplateColumns: "1.4fr 0.9fr 1.8fr 1fr 0.6fr 0.7fr 80px" }}
          >
            <div className="px-2.5 py-1.5">Name</div>
            <div className="px-2.5 py-1.5">ATS</div>
            <div className="px-2.5 py-1.5">Board URL</div>
            <div className="px-2.5 py-1.5">Category</div>
            <div className="px-2.5 py-1.5 text-right">Pri</div>
            <div className="px-2.5 py-1.5">Last</div>
            <div className="px-2.5 py-1.5">Status</div>
          </div>
          {companies.map(c => (
            <div
              key={c.id}
              onClick={() => openEdit(c)}
              className={
                "grid cursor-pointer items-center border-t border-[color:var(--border)] text-[11px] hover:bg-[color:var(--bg-row-hover)] " +
                (c.isActive ? "" : "opacity-60")
              }
              style={{ gridTemplateColumns: "1.4fr 0.9fr 1.8fr 1fr 0.6fr 0.7fr 80px" }}
            >
              <div className="truncate px-2.5 py-1.5">{c.name}</div>
              <div className="truncate px-2.5 py-1.5 text-[color:var(--text-sec)]">{c.ats}</div>
              <div className="truncate px-2.5 py-1.5 text-[color:var(--text-sec)]">{c.boardUrl}</div>
              <div className="truncate px-2.5 py-1.5 text-[color:var(--text-sec)]">{c.category ?? "—"}</div>
              <div className="px-2.5 py-1.5 text-right font-mono">{c.priority}</div>
              <div className="px-2.5 py-1.5 text-[color:var(--text-sec)]">{c.lastScraped ? relativeDate(c.lastScraped) : "—"}</div>
              <div className="px-2.5 py-1.5">
                {!c.isActive ? (
                  <span className="text-[color:var(--text-sec)]">inactive</span>
                ) : c.lastError ? (
                  <span className="text-[color:var(--danger)]" title={c.lastError}>ERR</span>
                ) : (
                  <span className="text-[color:var(--text-sec)]">OK</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {panelOpen && (
        <CompanyPanel
          key={editing?.id ?? "new"}
          company={editing}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}
      <Toast
        message={toast?.message ?? null}
        onRetry={toast?.retry}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
