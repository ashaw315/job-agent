"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

interface TopbarProps {
  lastScraped: string | null;
  onRefresh?: () => Promise<void>;
}

export default function Topbar({ lastScraped, onRefresh }: TopbarProps) {
  const [refreshing, setRefreshing] = useState(false);
  const pathname = usePathname();
  const isSettings = pathname.startsWith("/settings");

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="flex h-9 items-center justify-between border-b border-[color:var(--border)] px-4 text-[11px]">
      <span className="font-mono text-[color:var(--text-sec)]">job-agent</span>
      <div className="flex items-center gap-3">
        <span className="text-[color:var(--text-sec)]">
          {lastScraped ? `Last scraped ${lastScraped}` : "Never scraped"}
        </span>
        {isSettings ? (
          <Link
            href="/"
            className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
          >
            ← dashboard
          </Link>
        ) : (
          <Link
            href="/settings"
            className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)]"
          >
            Settings
          </Link>
        )}
        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh jobs"
            className="text-[color:var(--text-sec)] hover:text-[color:var(--text-pri)] disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={refreshing ? "animate-spin" : ""}>
              <path d="M14 8a6 6 0 1 1-1.76-4.24" />
              <path d="M14 2.5V6h-3.5" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
