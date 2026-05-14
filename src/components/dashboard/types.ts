import type { Job } from "@/lib/db/schema";

export type StatusValue = "new" | "interested" | "applied" | "interviewing" | "passed";

export const STATUS_VALUES: readonly StatusValue[] = [
  "new",
  "interested",
  "applied",
  "interviewing",
  "passed",
] as const;

export interface Filters {
  status: StatusValue | null;
  tier: 1 | 2 | 3 | null;
  minScore: number;
  search: string;
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
};

export const DEFAULT_SORT: Sort = {
  field: "score",
  dir: "desc",
};

/**
 * Convenience: re-export Job so component files have one import for everything dashboard-shaped.
 */
export type { Job };
