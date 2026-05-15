import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import type { Job } from "@/lib/db/schema";
import { and, eq, gte, desc, isNotNull } from "drizzle-orm";
import { getNotificationPrefs } from "@/lib/settings/notifications";
import { sendDigest as sendEmail } from "./email";

export interface DigestData {
  newToday: number;
  topByTier: { tier: 1 | 2 | 3; jobs: Job[] }[];
  interesting: Job[];
}

const TOP_SCORE_THRESHOLD = 70;
const INTERESTING_MIN = 50;
const INTERESTING_MAX = 70;
const DASHBOARD_URL_DEFAULT = "http://localhost:3001/";

/**
 * Fetch the data shape for today's digest.
 * "Today" = midnight UTC up to now.
 *
 * Returns the counts and per-bucket job lists. Caller decides whether to send.
 */
export async function buildDigestData(): Promise<DigestData> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // All jobs scraped today and still active. We don't filter by ai_score here
  // because the "newToday" count surfaces all scrapes, scored or not.
  const todaysJobs = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        gte(jobs.dateScraped, todayStart),
      )
    )
    .orderBy(desc(jobs.aiScore));

  // Top-scored jobs (must have an AI score >= 70). Group by tier; jobs without a
  // tier go into tier 3 as a fallback (rare but possible if the scorer returned
  // a score but no tier).
  const tops = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        gte(jobs.dateScraped, todayStart),
        gte(jobs.aiScore, TOP_SCORE_THRESHOLD),
        isNotNull(jobs.aiScore),
      )
    )
    .orderBy(desc(jobs.aiScore));

  const topByTier: { tier: 1 | 2 | 3; jobs: Job[] }[] = [
    { tier: 1, jobs: tops.filter(j => j.tier === 1) },
    { tier: 2, jobs: tops.filter(j => j.tier === 2) },
    { tier: 3, jobs: tops.filter(j => j.tier === 3 || j.tier == null) },
  ];

  // "Interesting" — 50–69. Same active+today gate.
  const interesting = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        gte(jobs.dateScraped, todayStart),
        gte(jobs.aiScore, INTERESTING_MIN),
        isNotNull(jobs.aiScore),
      )
    )
    .orderBy(desc(jobs.aiScore));

  const interestingFiltered = interesting.filter(j => (j.aiScore ?? 0) < INTERESTING_MAX);

  return {
    newToday: todaysJobs.length,
    topByTier,
    interesting: interestingFiltered,
  };
}

/**
 * Render the digest as inline-styled HTML.
 * Single-column, mobile-readable. Warm-mono palette to match the dashboard.
 */
export function renderDigestHtml(data: DigestData): string {
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || DASHBOARD_URL_DEFAULT;
  const totalTop = data.topByTier.reduce((sum, b) => sum + b.jobs.length, 0);

  const styles = {
    body: "margin: 0; padding: 0; background: #0a0907; color: #ece8df; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5;",
    container: "max-width: 620px; margin: 0 auto; padding: 24px 16px;",
    h1: "margin: 0 0 8px; font-size: 16px; font-weight: 500; color: #ece8df;",
    sub: "margin: 0 0 24px; font-size: 12px; color: #837e72;",
    h2: "margin: 24px 0 8px; font-size: 13px; font-weight: 500; color: #d4a64c; text-transform: uppercase; letter-spacing: 0.05em;",
    h3: "margin: 16px 0 4px; font-size: 11px; font-weight: 500; color: #837e72; text-transform: uppercase; letter-spacing: 0.05em;",
    job: "margin: 12px 0; padding: 12px; background: #0d0b08; border: 1px solid #18150f; border-radius: 4px;",
    jobTitle: "margin: 0 0 4px; font-size: 14px; color: #ece8df;",
    jobMeta: "margin: 0 0 8px; font-size: 12px; color: #837e72;",
    jobReason: "margin: 0; font-size: 12px; color: #ece8df; line-height: 1.45;",
    apply: "display: inline-block; margin-top: 8px; padding: 4px 10px; font-size: 11px; color: #d4a64c; text-decoration: none; border: 1px solid #d4a64c; border-radius: 3px;",
    score: "display: inline-block; padding: 1px 6px; font-size: 11px; font-weight: 500; color: #0a0907; background: #d4a64c; border-radius: 3px;",
    list: "margin: 0; padding: 0; list-style: none;",
    listItem: "padding: 8px 0; border-bottom: 1px solid #18150f; font-size: 13px;",
    listTitle: "color: #ece8df;",
    listMeta: "color: #837e72;",
    footer: "margin-top: 32px; padding-top: 16px; border-top: 1px solid #18150f; text-align: center;",
    footerLink: "color: #d4a64c; text-decoration: none; font-size: 12px;",
    empty: "padding: 24px; text-align: center; color: #837e72; font-size: 13px;",
  };

  const escape = (s: string | null | undefined): string =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const truncate = (s: string | null | undefined, n: number): string => {
    const str = String(s ?? "");
    return str.length <= n ? str : str.slice(0, n - 1) + "…";
  };

  const renderJob = (j: Job): string => {
    const score = Math.round(j.aiScore ?? 0);
    const company = escape(j.companyDisplayName || j.companyName);
    const title = escape(j.title);
    const location = j.location ? escape(j.location) : "";
    const reasoning = truncate(j.aiReasoning, 280);
    const url = escape(j.sourceUrl || dashboardUrl);

    return `
      <div style="${styles.job}">
        <div style="${styles.jobTitle}">
          <span style="${styles.score}">${score}</span>
          &nbsp;${title}
        </div>
        <div style="${styles.jobMeta}">
          ${company}${location ? ` · ${location}` : ""}
        </div>
        ${reasoning ? `<p style="${styles.jobReason}">${escape(reasoning)}</p>` : ""}
        <a href="${url}" style="${styles.apply}">View posting →</a>
      </div>
    `;
  };

  const renderTopSection = (): string => {
    if (totalTop === 0) {
      return `<div style="${styles.empty}">No top picks today (score 70+).</div>`;
    }
    return data.topByTier
      .filter(b => b.jobs.length > 0)
      .map(b => {
        const tierLabel = b.tier === 1 ? "Tier 1" : b.tier === 2 ? "Tier 2" : "Tier 3";
        return `
          <h3 style="${styles.h3}">${tierLabel} · ${b.jobs.length}</h3>
          ${b.jobs.map(renderJob).join("")}
        `;
      })
      .join("");
  };

  const renderInterestingSection = (): string => {
    if (data.interesting.length === 0) {
      return `<div style="${styles.empty}">No interesting jobs today (score 50–69).</div>`;
    }
    return `
      <ul style="${styles.list}">
        ${data.interesting.map(j => {
          const score = Math.round(j.aiScore ?? 0);
          const company = escape(j.companyDisplayName || j.companyName);
          const title = escape(j.title);
          const url = escape(j.sourceUrl || dashboardUrl);
          return `
            <li style="${styles.listItem}">
              <span style="${styles.score}">${score}</span>
              &nbsp;<a href="${url}" style="${styles.listTitle}; text-decoration: none;">${title}</a>
              <span style="${styles.listMeta}"> · ${company}</span>
            </li>
          `;
        }).join("")}
      </ul>
    `;
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>job-agent digest</title></head>
<body style="${styles.body}">
  <div style="${styles.container}">
    <h1 style="${styles.h1}">job-agent · daily digest</h1>
    <p style="${styles.sub}">${data.newToday} new today · ${totalTop} top pick${totalTop === 1 ? "" : "s"} · ${data.interesting.length} interesting</p>

    <h2 style="${styles.h2}">Top picks · 70+</h2>
    ${renderTopSection()}

    <h2 style="${styles.h2}">Interesting · 50–69</h2>
    ${renderInterestingSection()}

    <div style="${styles.footer}">
      <a href="${dashboardUrl}" style="${styles.footerLink}">Open dashboard →</a>
    </div>
  </div>
</body></html>`;
}

/**
 * Build the digest subject line.
 * Format: "job-agent: N new (M top picks)".
 */
export function renderDigestSubject(data: DigestData): string {
  const totalTop = data.topByTier.reduce((sum, b) => sum + b.jobs.length, 0);
  return `job-agent: ${data.newToday} new (${totalTop} top pick${totalTop === 1 ? "" : "s"})`;
}

/**
 * Build and send today's digest unconditionally to the given email.
 * Throws if sending fails. Used by both maybeRunDigest (with prefs check)
 * and POST /api/digest/test (bypasses prefs).
 */
export async function buildAndSendDigest(to: string): Promise<{ sentTo: string; subject: string; newToday: number }> {
  const data = await buildDigestData();
  const html = renderDigestHtml(data);
  const subject = renderDigestSubject(data);
  await sendEmail(html, subject, to);
  return { sentTo: to, subject, newToday: data.newToday };
}

/**
 * Check user prefs and send the digest if today's frequency matches.
 * Called at the end of runScrapePipeline().
 *
 * Returns a status string suitable for logging. Never throws — caller wraps
 * in try/catch but errors are swallowed at the pipeline level.
 */
export async function maybeRunDigest(): Promise<string> {
  const prefs = await getNotificationPrefs();

  if (prefs.paused) return "digest skipped: paused";
  if (prefs.frequency === "manual") return "digest skipped: frequency=manual";

  // weekdays gate — Saturday and Sunday UTC are skipped
  if (prefs.frequency === "weekdays") {
    const day = new Date().getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return "digest skipped: weekend (frequency=weekdays)";
  }

  if (!prefs.email) return "digest skipped: no recipient email configured";

  const result = await buildAndSendDigest(prefs.email);
  return `digest sent to ${result.sentTo} · "${result.subject}"`;
}
