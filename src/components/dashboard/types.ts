import type { Job } from "@/lib/db/schema";

export type StatusValue = "new" | "interested" | "applied" | "interviewing" | "passed";

export const STATUS_VALUES: readonly StatusValue[] = [
  "new",
  "interested",
  "applied",
  "interviewing",
  "passed",
] as const;

export type SourceCategory = "boards" | "aggregators" | "manual";

/**
 * Map source-category labels to the set of jobs.source slugs that belong in them.
 * "All" is represented by `null` in the Filters object, not by a category here.
 */
export const SOURCE_CATEGORY_SLUGS: Record<SourceCategory, readonly string[]> = {
  boards: ["greenhouse", "lever", "ashby"],
  aggregators: ["builtinnyc", "weworkremotely", "dribbble", "awwwards", "mediabistro", "whitney", "creativeapplications"],
  manual: ["manual"],
} as const;

export interface Filters {
  status: StatusValue | null;
  tier: 1 | 2 | 3 | null;
  minScore: number;
  search: string;
  sourceCategory: SourceCategory | null;
}

export type SortField = "score" | "title" | "company" | "date";

export interface Sort {
  field: SortField;
  dir: "asc" | "desc";
}

export const DEFAULT_FILTERS: Filters = {
  status: null,
  tier: null,
  minScore: 0,
  search: "",
  sourceCategory: null,
};

export const DEFAULT_SORT: Sort = {
  field: "score",
  dir: "desc",
};

/**
 * Convenience: re-export Job so component files have one import for everything dashboard-shaped.
 */
export type { Job };
