import { Job } from "../db/schema";
import { AIScoreResponse } from "../types";
import { AI_SCORING_MODEL, AI_SCORING_MAX_TOKENS } from "../constants";

const AI_SCORING_PROMPT = `You are evaluating a job listing for fit with a specific candidate.

## Candidate Profile
{profile}

## Job Listing
Title: {title}
Company: {company}
Location: {location}
Salary: {salary}
Description:
{description}

## Your Task
Rate this job's fit on a scale of 1-100 and explain your reasoning. Consider:
1. Does the candidate's technical skill set match the requirements?
2. Does his MFA/art background add value or is it irrelevant?
3. Is the experience level realistic (he has ~4 years in tech, ~15 years total professional)?
4. Does the salary likely clear $110k (if not listed, estimate based on role/company/location)?
5. Is this a role where he'd be competitive against the typical applicant pool?
6. Does this align with his goal of finding a role that uses both creative and technical skills?

IMPORTANT SCORING GUIDANCE:
- Be skeptical, not generous. A score of 70+ should mean "Adam would likely get an interview." A score of 50-69 means "worth applying but it's a stretch." Below 50 means "don't bother."
- If the role requires specific professional experience Adam doesn't have (e.g., "5+ years leading brand campaigns"), score it below 40 regardless of other signals.
- Distinguish between "nice to have" and "required" qualifications. Adam's MFA and art background can cover "nice to have" creative experience, but cannot substitute for required years in a specific professional discipline.
- A title match alone is not sufficient. "Creative Director" matches his interests but he cannot compete for that title today.
- Weight realistic competitiveness heavily. Ask: "Would a hiring manager look at Adam's resume and see someone qualified, or someone aspirational?"

SPECIFIC SCORING TRAPS TO AVOID:

1. "Uses AI tools" ≠ "builds AI products." The candidate uses Claude Code, Copilot, and Cursor for development — that's AI-assisted coding, not AI systems engineering. If a role requires building agentic UIs, training models, designing AI interaction paradigms, or working with world models, that's a different domain. Don't match "AI tools on resume" with "AI product role." Score these below 40 unless the candidate's independent projects (LoRA training, generative pipelines) specifically overlap with the role's AI requirements.

2. "Design Engineer" requires design evidence. If the title says Design Engineer, check: does the candidate have prototyping experience, Figma skills, interaction design, usability testing, or a design portfolio? An MFA in fine art is adjacent but not the same as interaction design. If the role emphasizes UX process, design systems methodology, or user research — and the candidate's experience is primarily writing React components — flag it as a stretch (50-60), not a strong fit.

3. R&D/lab roles vs product engineering. Words like "exploratory," "experimental," "research-oriented," "ambiguous problem space," and "lab environment" signal self-directed research work. The candidate's professional experience is sprint-based enterprise delivery and client work. Side projects show creative exploration but not in a professional R&D context. Weight this as a negative signal (-10 to -15 points) for research-heavy roles.

4. Seniority and compensation band mismatch. When a well-funded startup (Series B+) posts a role without "junior" or "mid-level" and the expected TC is 2-3x the candidate's salary floor ($110k), the implicit seniority expectation is likely above the candidate's ~4 years of engineering experience. A $300K+ TC role at an AI startup expects 7+ years or domain expertise the candidate doesn't have. Score these honestly as long shots (30-40), not aspirational reaches.

5. Niche skills vs commodity skills. Distinguish between skills that are easy to bridge (a React developer can learn Vue in weeks) and skills that represent deep domain knowledge (agentic systems, compiler design, ML infrastructure). If a role lists niche requirements the candidate hasn't demonstrated, don't assume adjacency. "Built a Kafka messaging system" doesn't bridge to "design agentic tool interfaces." Be specific about which requirements the candidate actually meets vs which are aspirational.

ADDITIONAL SCORING DIMENSION:
This candidate is also interested in non-engineering roles where coding ability is a competitive advantage even if not explicitly required. Roles like creative producer, creative operations manager, brand marketing manager, or editorial roles at companies where technical fluency differentiates him from other applicants. If the role would benefit from someone who can code (automate workflows, build internal tools, prototype concepts, speak to engineers credibly) even though it doesn't list coding as a requirement, add 10-15 points to the score and note this in green_flags as "coding as competitive edge."

Respond in JSON only, no markdown fences:
{"score": <number 1-100>, "reasoning": "<2-3 sentences>", "tier": <1|2|3>, "role_category": "<category>", "salary_estimate": "<range if not listed>", "red_flags": "<any concerns>", "green_flags": "<strongest fit signals>"}`;

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

    if (typeof parsed.score !== "number" || parsed.score < 1 || parsed.score > 100) {
      console.error("AI score out of range:", parsed.score);
      return null;
    }

    return parsed;
  } catch (err) {
    console.error("AI scoring failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
