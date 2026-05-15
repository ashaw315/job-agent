"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import type { WatchedCompany } from "@/lib/db/schema";
import type { HardFilters } from "@/lib/settings/hard-filters";

const TAB_VALUES = ["profile", "filters", "companies", "danger"] as const;
type TabValue = typeof TAB_VALUES[number];

interface SettingsProps {
  initialProfile: string;
  initialHardFilters: HardFilters;
  initialCompanies: WatchedCompany[];
  jobsTotal: number;
  lastScrapedLabel: string | null;
}

export default function Settings({ initialProfile, initialHardFilters, initialCompanies, jobsTotal, lastScrapedLabel }: SettingsProps) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get("tab");
  const tab: TabValue = (TAB_VALUES as readonly string[]).includes(raw ?? "") ? (raw as TabValue) : "profile";

  // If the URL had an invalid value, rewrite to a clean one
  useEffect(() => {
    if (raw && !TAB_VALUES.includes(raw as TabValue)) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "profile");
      router.replace(`${pathname}${url.search}`);
    }
  }, [raw, router, pathname]);

  const setTab = (next: TabValue) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    router.replace(`${pathname}${url.search}`);
  };

  return (
    <>
      <div className="flex h-9 items-center gap-6 border-b border-[color:var(--border)] px-4 text-[12px]">
        <TabButton label="Profile" value="profile" active={tab === "profile"} onClick={setTab} />
        <TabButton label="Hard Filters" value="filters" active={tab === "filters"} onClick={setTab} />
        <TabButton label="Watched Companies" value="companies" active={tab === "companies"} onClick={setTab} />
        <TabButton label="● Danger Zone" value="danger" active={tab === "danger"} onClick={setTab} danger />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "profile" && (
          <Placeholder name={`Profile (${initialProfile.length} chars loaded)`} />
        )}
        {tab === "filters" && (
          <Placeholder name={`Hard Filters (${JSON.stringify(initialHardFilters)})`} />
        )}
        {tab === "companies" && (
          <Placeholder name={`Companies (${initialCompanies.length} loaded, last scraped ${lastScrapedLabel ?? "never"})`} />
        )}
        {tab === "danger" && (
          <Placeholder name={`Danger Zone (${jobsTotal} jobs)`} />
        )}
      </div>
    </>
  );
}

function TabButton({ label, value, active, onClick, danger }: { label: string; value: TabValue; active: boolean; onClick: (v: TabValue) => void; danger?: boolean }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={
        "border-b py-2 transition-colors " +
        (active
          ? "border-[color:var(--accent)] text-[color:var(--text-pri)]"
          : `border-transparent ${danger ? "text-[color:var(--danger)]" : "text-[color:var(--text-sec)]"} hover:text-[color:var(--text-pri)]`)
      }
    >
      {label}
    </button>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-6 text-[color:var(--text-sec)] text-[12px]">
      <p>Tab: {name}</p>
      <p className="mt-2 text-[color:var(--text-tert)]">Implementation comes in the next tasks.</p>
    </div>
  );
}
