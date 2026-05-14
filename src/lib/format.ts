import type { Job } from "@/lib/db/schema";

/**
 * Display rule: AI score if present, else keyword score.
 * Sort and the score column both consult this — keeps display and ordering aligned.
 */
export function scoreDisplay(job: Job): { value: number; source: "ai" | "keyword" } {
  if (job.aiScore != null) {
    return { value: Math.round(job.aiScore), source: "ai" };
  }
  return { value: Math.round(job.keywordScore ?? 0), source: "keyword" };
}

/**
 * Short relative date: "2d", "5h", "now". Returns "—" for null.
 */
export function relativeDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

/**
 * Tier number → CSS color variable name (returned as a CSS value).
 * T1 = accent, T2 = primary, T3 = secondary, else null tier = secondary.
 */
export function tierColor(tier: number | null): string {
  if (tier === 1) return "var(--accent)";
  if (tier === 2) return "var(--text-pri)";
  return "var(--text-sec)";
}
