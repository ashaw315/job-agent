import { Job } from "../db/schema";
import { AIScoreResponse } from "../types";
import { AI_SCORING_MODEL, AI_SCORING_MAX_TOKENS } from "../constants";

const AI_SCORING_PROMPT = `You are evaluating a job listing for fit with a specific candidate.

## Candidate Profile
- 38 years old, based in Brooklyn, NYC
- MFA in Studio Art from Hunter College (2020), BS in Studio Art from Skidmore (2005-2010)
- Full-stack developer: React, Redux, Next.js, TypeScript, Ruby on Rails, Node.js, GraphQL, PostgreSQL, AWS, Kafka
- Currently Software Developer at Booz Allen Hamilton (2023-present): enterprise-scale VA applications, Kafka messaging systems, React modernization
- Previously Software Engineer at RGB Systems (2022-2023): client websites, Gatsby, Strapi, Shopify, WordPress
- Pre-tech: elementary school art teacher (~2011-2013), freelance art handler at NYC galleries/institutions (~2013-2021)
- Fabrication skills: laser cutting, vinyl cutting, 3D printing, SketchUp
- Design tools: Adobe Creative Suite
- Fine art practice: gallery exhibitions, painting, installation, mixed media, image transfer, silkscreen
- Conceptual coding projects: AI/LoRA generative art, datamosh video archive, collaborative drawing tools
- Has led projects but not managed people directly
- Salary floor: $110,000
- Wants: full-time, NYC or remote, hybrid OK. No freelance, no academia.

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

Respond in JSON only, no markdown fences:
{"score": <number 1-100>, "reasoning": "<2-3 sentences>", "tier": <1|2|3>, "role_category": "<category>", "salary_estimate": "<range if not listed>", "red_flags": "<any concerns>", "green_flags": "<strongest fit signals>"}`;

/**
 * Score a job using Claude API.
 * Only called for jobs with keyword_score >= 50 that haven't been AI-scored yet.
 */
export async function scoreWithAI(job: Job): Promise<AIScoreResponse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — skipping AI scoring");
    return null;
  }

  const prompt = AI_SCORING_PROMPT
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
