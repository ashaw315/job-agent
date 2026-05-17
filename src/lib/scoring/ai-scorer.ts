import { Job } from "../db/schema";
import { AIScoreResponse } from "../types";
import { AI_SCORING_MODEL, AI_SCORING_MAX_TOKENS } from "../constants";

const AI_SCORING_PROMPT = `You are evaluating job listings for a specific candidate. Your job is to determine realistic fit — not optimistic fit. Be skeptical. A hiring manager seeing this candidate's resume needs to feel "this person is qualified," not "this person is interesting but a stretch."

## Candidate Profile
{profile}

## North star
The candidate's primary value is creative, institutional, and conceptual thinking. Code is the amplifier, not the identity. The best roles use his art-world background AND his engineering skills together. Pure engineering roles where the art/MFA background is irrelevant are a poor fit even when the tech stack matches.

## Job Listing
Title: {title}
Company: {company}
Location: {location}
Salary: {salary}
Description:
{description}

────────────────────────────────────────────────────────
## STEP 1 — Hard disqualifiers (auto-score 0)

If ANY of these apply, return score: 0 and fit_confidence: "no_fit". Do not weigh other signals; the role is out of scope.

Wrong primary skill stack (required, not "nice to have"):
- Unity / Unreal / C++ / Rust / Go / Swift / Kotlin / Java at expert level
- Cinema 4D / Blender / Houdini at expert level
- Native iOS or Android development
- Embedded / firmware / hardware engineering
- Mechanical, electrical, chemical, or process engineering
- ASIC / silicon / semiconductor / photonics

Wrong experience level:
- Required 8+ years of specific professional experience
- "Senior" or "Staff" level requiring 7+ years engineering leadership
- Director / VP / Head-of level
- Required prior people-management experience

Wrong employment model:
- Freelance, contract, 1099, internship
- Pure sales / business development / account management
- Academic / faculty / postdoc / research-fellow positions

Wrong location:
- On-site or hybrid roles MUST be in the NYC metro area (New York City, Brooklyn, Manhattan, Queens, Bronx, Jersey City, Hoboken). Boston, Washington DC, San Francisco, Philadelphia, Tel Aviv, London, and all other non-NYC locations are disqualifiers unless the listing explicitly says "remote" or lists NYC as one of multiple office options. When in doubt about location, check the full description.
- Visa-sponsorship required (he is a US citizen but the role asking implies it's not aimed at him)

If you auto-score 0, still fill out role_category honestly, set north_star_alignment to a short reason, and put the specific disqualifier in "gap". Skip the rest of the steps.

────────────────────────────────────────────────────────
## STEP 2 — Classify role_category

Pick exactly ONE from this closed set. Use "other" only if nothing fits.

- creative_technologist — bridges creative concept and code (studios, R&D labs that ship public-facing experiences)
- experience_designer — interactive installations, exhibits, immersive
- exhibition_designer — museum / gallery exhibitions, physical + digital
- design_technologist — codes design systems / prototypes / front-end with strong design judgment
- digital_preservation — archives, conservation, collections, digitization
- creative_ops — production / operations inside creative orgs
- creative_producer — produces creative work, runs projects across creative + tech
- design_strategist — frames problems for design / brand teams
- design_engineer — front-end engineering with design literacy (the saturated, often-mismatched bucket)
- art_world_tech — engineering inside auction houses, galleries, art platforms
- media_editorial — engineering / product inside editorial / publishing orgs
- engineering_creative — generalist engineering inside a creative-adjacent company
- other — none of the above

────────────────────────────────────────────────────────
## STEP 3 — Base score from the 5-band framework

Pick the band that best matches the role. Score within the band.

80–100 — Competitive fit. Adam would likely get an interview. Role uses both art-world background AND engineering. Title and seniority match. Stack overlaps significantly. fit_confidence: "competitive".

65–79 — Strong stretch. Honest shot — most boxes check, but one notable gap (slightly senior, partial stack overlap, or art-background-as-bonus rather than-required). fit_confidence: "stretch".

50–64 — Real stretch. Plausible but the gap is real (seniority, niche stack, or the creative dimension is thin). Apply only if energized. fit_confidence: "stretch".

35–49 — Long shot. The role is interesting but the fit isn't there yet — wrong seniority, wrong specialization, or weak north-star alignment. fit_confidence: "long_shot".

Below 35 — Poor fit. Tech-stack-only match, no creative dimension, or material disqualifier that didn't quite hit STEP 1. fit_confidence: "long_shot" or "no_fit".

────────────────────────────────────────────────────────
## STEP 4 — Apply company-context modifier

Add the modifier to the band score. Modifiers stack with band placement but should not push a no-fit into competitive — if you're tempted to apply +15 to a role that fails STEP 1 hard, recheck STEP 1.

+15 — Museums, cultural institutions, auction houses (Sotheby's, Christie's, Whitney, MoMA, New Museum, Met, Guggenheim, Smithsonian, etc.). The candidate's gallery/institutional background is genuine domain expertise.
+15 — Experiential / interactive studios (Local Projects, Bluecadet, Deeplocal, MediaMonks, Active Theory, etc.). Fabrication + code + art is exactly the profile they hire.
+10 — Art-adjacent tech / collecting / art platforms (1stDibs, Artsy, Saatchi, Artnet, etc.).
+10 — Design consultancies and brand studios (IDEO, frog, Pentagram, Sub Rosa, Instrument, etc.).
+10 — Design-forward tech (Linear, Vercel, Figma, Stripe design org, Notion design org).
+5  — Media / editorial (New York Times, Vox Media, Condé Nast, The Atlantic, The New Yorker, Hearst).
+5  — AI creative-tools companies (Runway, Krea, Recraft) — only when the role is design/creative-side, not ML-research side.
 0  — Generic tech / SaaS / enterprise software with no creative dimension.
-10 — Enterprise consulting, big-co IT, agencies-as-staff-aug.
-15 — Defense / enterprise SaaS / fintech back-office.
-20 — Companies with no creative dimension AND no art-world overlap AND in domains the candidate has no signal in (logistics, supply chain, ad-tech back-office, etc.).

────────────────────────────────────────────────────────
## STEP 5 — Sanity traps (apply BEFORE finalizing)

These traps recur. Walk through them explicitly before locking the score.

1. "Uses AI tools" ≠ "builds AI products." Adam uses Claude / Copilot / Cursor. That is AI-assisted coding, not building agentic systems, training models, or designing AI UX. If the role requires the latter, do not score it as a strong fit on the basis of "AI experience."

2. "Design Engineer" requires design evidence. Title is one of the most overloaded in tech. If the role emphasizes Figma fluency, design-systems methodology, prototyping, interaction design, user research, or a portfolio — Adam's MFA in fine art is adjacent, not the same. Without explicit interaction-design / Figma / design-systems work, a design-engineer role tops out around 65.

3. R&D / lab / "experimental" roles. Words like "exploratory," "ambiguous problem space," "lab environment" signal self-directed research. Adam's professional experience is sprint-based enterprise delivery; the research dimension lives in side projects. Penalize -10 to -15 for research-heavy roles unless the company is explicitly hiring the artist-coder profile.

4. Seniority + comp mismatch. Series B+ startup, no "junior/mid" qualifier, TC $300k+ implies 7+ years or domain expertise the candidate lacks. Score honestly as long shot, not aspirational reach.

5. Tech-stack-only match. If the only reason a generic tech role scores well is because React + TypeScript appears, and the company has zero creative / institutional dimension — that role tops out around 55. Stack overlap alone is not a strong fit for this candidate.

6. "Coding as competitive edge" for non-engineering roles. If the role is creative producer, creative ops, brand marketing, editorial — and Adam's coding fluency would differentiate him from typical applicants (automate workflows, build internal tools, prototype concepts, talk to engineers) — add +10 to +15 and note it in green_flags. This is genuinely the most undervalued vector.

────────────────────────────────────────────────────────
## Final output

Be honest about gaps. A score in the 35–49 band is not a failure — it's accurate. The candidate has time to apply to ~5 jobs a day; misrating long shots as competitive wastes that budget.

Set fit_confidence based on band:
- 80–100 → "competitive"
- 50–79 → "stretch"
- 35–49 → "long_shot"
- below 35 → "no_fit"

north_star_alignment: ONE short sentence on whether/how this role uses creative + institutional + conceptual thinking as primary value (vs. coding as primary value). Be concrete — "uses art-world judgment" beats "creative role."

gap: For scores below 65, ONE short sentence naming the single biggest thing missing for this candidate (seniority, stack, domain, employment model). For scores 65+, can be empty string "".

Respond in JSON only, no markdown fences:
{"score": <number 0-100>, "reasoning": "<2-3 sentences>", "tier": <1|2|3>, "role_category": "<one of the 13 categories>", "fit_confidence": "<competitive|stretch|long_shot|no_fit>", "north_star_alignment": "<one sentence>", "gap": "<one sentence or empty>", "salary_estimate": "<range if not listed>", "red_flags": "<concerns>", "green_flags": "<strongest fit signals>"}`;

const VALID_ROLE_CATEGORIES = new Set([
  "creative_technologist",
  "experience_designer",
  "exhibition_designer",
  "design_technologist",
  "digital_preservation",
  "creative_ops",
  "creative_producer",
  "design_strategist",
  "design_engineer",
  "art_world_tech",
  "media_editorial",
  "engineering_creative",
  "other",
]);

const VALID_FIT_CONFIDENCE = new Set(["competitive", "stretch", "long_shot", "no_fit"]);

/**
 * Score a job using Claude API.
 * Only called for jobs with keyword_score >= 50 that haven't been AI-scored yet.
 * Profile is read by the pipeline once per run and passed in here.
 */
export async function scoreWithAI(job: Job, profile: string): Promise<AIScoreResponse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — skipping AI scoring");
    return null;
  }

  const prompt = AI_SCORING_PROMPT
    .replace("{profile}", profile)
    .replace("{title}", job.title)
    .replace("{company}", job.companyDisplayName || job.companyName)
    .replace("{location}", job.location || "Not specified")
    .replace("{salary}", job.salaryText || "Not listed")
    .replace("{description}", (job.description || "").slice(0, 6000));

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_SCORING_MODEL,
        max_tokens: AI_SCORING_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`Claude API error ${res.status}: ${errorBody}`);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed: AIScoreResponse = JSON.parse(clean);

    // Score range: 0-100 (0 is reserved for hard disqualifiers).
    if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) {
      console.error("AI score out of range:", parsed.score);
      return null;
    }

    if (!VALID_ROLE_CATEGORIES.has(parsed.role_category)) {
      console.warn(`AI returned unknown role_category "${parsed.role_category}" — coercing to "other"`);
      parsed.role_category = "other";
    }

    if (!VALID_FIT_CONFIDENCE.has(parsed.fit_confidence)) {
      console.warn(`AI returned unknown fit_confidence "${parsed.fit_confidence}" — coercing to "long_shot"`);
      parsed.fit_confidence = "long_shot";
    }

    return parsed;
  } catch (err) {
    console.error("AI scoring failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
