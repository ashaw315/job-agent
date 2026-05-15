import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ScrapedJob } from "@/lib/types";

type RemotePolicy = "onsite" | "hybrid" | "remote";

export interface HardFilters {
  location: "nyc_only" | "remote_only" | "nyc_remote" | "all";
  salaryFloor: number;
  employmentTypes: ("full_time" | "temp_to_perm")[];
}

export const DEFAULT_HARD_FILTERS: HardFilters = {
  location: "nyc_remote",
  salaryFloor: 110000,
  employmentTypes: ["full_time", "temp_to_perm"],
};

export async function getHardFilters(): Promise<HardFilters> {
  const row = await db.select().from(settings).where(eq(settings.key, "hard_filters")).limit(1);
  if (!row[0]) return DEFAULT_HARD_FILTERS;
  try {
    const parsed = JSON.parse(row[0].value);
    return { ...DEFAULT_HARD_FILTERS, ...parsed };
  } catch {
    return DEFAULT_HARD_FILTERS;
  }
}

/**
 * Returns whether a scraped job passes all hard filters.
 * Salary rule: only excludes when salary is KNOWN to be below the floor.
 * Unknown salary lets the job through.
 * Employment type: keyword-exclude on description+title when temp_to_perm unchecked.
 * full_time unchecked has no effect (no good negative keywords for "not full time").
 */
export function applyHardFilters(
  job: ScrapedJob,
  scored: { salary_min: number | null; salary_max: number | null; remote_policy: RemotePolicy | null },
  filters: HardFilters
): { passes: boolean; reason: string | null } {
  // location
  if (filters.location !== "all") {
    const wantsNyc = filters.location === "nyc_only" || filters.location === "nyc_remote";
    const wantsRemote = filters.location === "remote_only" || filters.location === "nyc_remote";
    const isNyc = scored.remote_policy === "onsite" || scored.remote_policy === "hybrid";
    const isRemote = scored.remote_policy === "remote" || scored.remote_policy === "hybrid";
    if (!((wantsNyc && isNyc) || (wantsRemote && isRemote))) {
      return { passes: false, reason: "location" };
    }
  }
  // salary
  if (scored.salary_max != null && scored.salary_max < filters.salaryFloor) {
    return { passes: false, reason: "salary" };
  }
  // employment type
  if (!filters.employmentTypes.includes("temp_to_perm")) {
    const desc = (job.description ?? "").toLowerCase();
    const title = job.title.toLowerCase();
    const tempTerms = ["contract", "1099", "temp-to-perm", "freelance"];
    if (tempTerms.some(t => desc.includes(t) || title.includes(t))) {
      return { passes: false, reason: "employment_type" };
    }
  }
  return { passes: true, reason: null };
}
