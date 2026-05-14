"use client";

import { useState, useCallback } from "react";
import type { Job } from "@/lib/db/schema";
import Topbar from "./Topbar";

interface DashboardProps {
  initialJobs: Job[];
  lastScraped: string | null;
}

export default function Dashboard({ initialJobs, lastScraped }: DashboardProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  const handleRefresh = useCallback(async () => {
    const res = await fetch("/api/jobs?active=true&limit=2000");
    if (!res.ok) return; // Toast handling comes in Task 13
    const data = await res.json();
    setJobs(data.jobs as Job[]);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Topbar lastScraped={lastScraped} onRefresh={handleRefresh} />
      <main className="flex-1 p-4 text-[color:var(--text-sec)]">
        {jobs.length} jobs loaded — chrome coming in next tasks
      </main>
    </div>
  );
}
