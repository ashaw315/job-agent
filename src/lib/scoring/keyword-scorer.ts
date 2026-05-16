import { ScrapedJob } from "../types";
import {
  POSITIVE_SIGNALS,
  NEGATIVE_SIGNALS,
  SCORE_THRESHOLD_ARCHIVE,
} from "../constants";
import { parseSalary } from "../utils";

const SALARY_FLOOR = 110000;

type RemotePolicy = "onsite" | "hybrid" | "remote";

interface KeywordScoreResult {
  score: number; // 0-100 clamped
  remote_policy: RemotePolicy | null;
  salary_min: number | null;
  salary_max: number | null;
  auto_archive: boolean;
}

/**
 * Score a job using keyword/rule-based heuristics.
 * This is cheap and runs on every scraped job before we decide
 * whether to spend Claude API tokens on AI scoring.
 */
export function scoreKeywords(job: ScrapedJob): KeywordScoreResult {
  let score = 0;
  let titleDisqualifierHit = false;
  const titleLower = job.title.toLowerCase();
  const descLower = (job.description || "").toLowerCase();
  const locationLower = (job.location || "").toLowerCase();

  // ── Positive: title exact match ──
  for (const term of POSITIVE_SIGNALS.title_exact.terms) {
    if (titleLower.includes(term)) {
      score += POSITIVE_SIGNALS.title_exact.weight;
      break; // Only count once even if multiple match
    }
  }

  // ── Positive: title partial match ──
  for (const term of POSITIVE_SIGNALS.title_partial.terms) {
    if (titleLower.includes(term)) {
      score += POSITIVE_SIGNALS.title_partial.weight;
      break;
    }
  }

  // ── Positive: strong description signals (capped) ──
  let strongDescScore = 0;
  for (const term of POSITIVE_SIGNALS.description_strong.terms) {
    if (descLower.includes(term)) {
      strongDescScore += POSITIVE_SIGNALS.description_strong.weight;
    }
  }
  score += Math.min(strongDescScore, POSITIVE_SIGNALS.description_strong.cap);

  // ── Positive: moderate description signals (capped) ──
  let modDescScore = 0;
  for (const term of POSITIVE_SIGNALS.description_moderate.terms) {
    if (descLower.includes(term)) {
      modDescScore += POSITIVE_SIGNALS.description_moderate.weight;
    }
  }
  score += Math.min(modDescScore, POSITIVE_SIGNALS.description_moderate.cap);

  // ── Positive: institutional / museum vocabulary (capped) ──
  let instDescScore = 0;
  for (const term of POSITIVE_SIGNALS.description_institutional.terms) {
    if (descLower.includes(term)) {
      instDescScore += POSITIVE_SIGNALS.description_institutional.weight;
    }
  }
  score += Math.min(instDescScore, POSITIVE_SIGNALS.description_institutional.cap);

  // ── Positive: location ──
  let remote_policy: RemotePolicy | null = null;

  for (const term of POSITIVE_SIGNALS.location_nyc.terms) {
    if (locationLower.includes(term)) {
      score += POSITIVE_SIGNALS.location_nyc.weight;
      remote_policy = "onsite"; // may be overridden below
      break;
    }
  }

  for (const term of POSITIVE_SIGNALS.location_remote.terms) {
    if (locationLower.includes(term) || descLower.includes(term)) {
      score += POSITIVE_SIGNALS.location_remote.weight;
      remote_policy = remote_policy ? "hybrid" : "remote";
      break;
    }
  }

  // ── Positive: salary ──
  const { min: salaryMin, max: salaryMax } = parseSalary(job.salary_text);
  if (salaryMin && salaryMin >= SALARY_FLOOR) {
    score += 10; // salary_above_floor
  } else if (salaryMax && salaryMax >= SALARY_FLOOR) {
    score += 5; // range crosses floor
  }

  // ── Negative: title signals ──
  // A title_negative match is a hard disqualifier, not just a score penalty.
  // We still apply the weight (so the final score reflects the hit), but the
  // job is also force-archived regardless of how high positives push the score.
  // This catches cases like "Sr. Silicon Photonics Design Engineer" where the
  // +30 from "design engineer" title_exact overpowers the -30 silicon penalty.
  for (const term of NEGATIVE_SIGNALS.title_negative.terms) {
    if (titleLower.includes(term)) {
      score += NEGATIVE_SIGNALS.title_negative.weight;
      titleDisqualifierHit = true;
      break;
    }
  }

  // ── Negative: description signals ──
  for (const term of NEGATIVE_SIGNALS.description_negative.terms) {
    if (descLower.includes(term)) {
      score += NEGATIVE_SIGNALS.description_negative.weight;
    }
  }

  // ── Negative: experience mismatch ──
  for (const term of NEGATIVE_SIGNALS.experience_mismatch.terms) {
    if (descLower.includes(term)) {
      score += NEGATIVE_SIGNALS.experience_mismatch.weight;
    }
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    remote_policy,
    salary_min: salaryMin,
    salary_max: salaryMax,
    auto_archive: titleDisqualifierHit || score < SCORE_THRESHOLD_ARCHIVE,
  };
}
