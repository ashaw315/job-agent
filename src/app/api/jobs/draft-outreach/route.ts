import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs as jobsTable } from "@/lib/db/schema";
import { getProfile } from "@/lib/settings/profile";
import { AI_SCORING_MODEL, AI_SCORING_MAX_TOKENS } from "@/lib/constants";

interface SuccessResponse {
  success: true;
  draft: string;
}
interface ErrorResponse {
  success: false;
  error: "missing_id" | "not_found" | "not_scored" | "no_api_key" | "claude_error" | "internal";
}
type ApiResponse = SuccessResponse | ErrorResponse;

const OUTREACH_PROMPT = `You are drafting a short, genuine outreach email from a job candidate to a recruiter or hiring manager. The candidate is interested in the role below. Write the email he would send.

## Candidate profile
{profile}

## Role
Title: {title}
Company: {company}
Location: {location}

## Why the candidate (from prior AI scoring)
Reasoning: {reasoning}
Strongest fit signals: {green_flags}
North-star alignment: {north_star}

## What to write

Write 3–4 short paragraphs, under 200 words total. The opening should NOT be "I came across your role" or "I was excited to see" — those are templated and immediately tune the reader out. Open with something specific to this role or company.

Reference 1–2 concrete aspects of the role that match the candidate's actual background — pull from the green_flags and reasoning, not generic skills. Then highlight ONE specific project or experience that's directly relevant (the candidate's MFA, his gallery/institutional handling work, his AI/LoRA generative-art projects, his fabrication skills, or his Booz Allen / RGB Systems engineering work — pick the one most relevant to THIS role, not all of them).

Tone: conversational, genuine, slightly understated. He is not selling himself as the perfect candidate — he is making a specific case for why this conversation would be worth having. Avoid:
- "I'm excited about", "I'd love to", "I'm passionate about" — sycophantic openers
- Listing every skill ("React, TypeScript, Node, GraphQL...") — pick what matters
- "I believe my unique combination of..." — templated phrasing
- Asking for an interview directly — let the email earn it

Close with both portfolio links naturally — one in the body if relevant to a project, one in a brief signature line. Use exactly these URLs:
- adamshaw.world
- adamshaw.studio

Output ONLY the email body (no subject line, no "Hi Hiring Manager," boilerplate — start with the first real sentence). Do not wrap in code fences or quotes.`;

/**
 * POST /api/jobs/draft-outreach
 *
 * Body: { id: string }
 *
 * Generates a short outreach email for an AI-scored job. The draft is returned
 * to the client and not persisted — re-clicking generates a fresh one.
 *
 * Only AI-scored jobs (ai_score != null) are eligible: the prompt relies on
 * reasoning + green_flags + north_star_alignment to ground the email in the
 * candidate's actual fit signals, not generic skills.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ success: false, error: "missing_id" }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ success: false, error: "no_api_key" }, { status: 503 });

    const rows = await db.select().from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
    const job = rows[0];
    if (!job) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    if (job.aiScore === null) {
      return NextResponse.json({ success: false, error: "not_scored" }, { status: 400 });
    }

    const profile = await getProfile();
    const prompt = OUTREACH_PROMPT
      .replace("{profile}", profile)
      .replace("{title}", job.title)
      .replace("{company}", job.companyDisplayName || job.companyName)
      .replace("{location}", job.location || "Not specified")
      .replace("{reasoning}", job.aiReasoning || "(no reasoning recorded)")
      .replace("{green_flags}", job.aiGreenFlags || "(none recorded)")
      .replace("{north_star}", job.northStarAlignment || "(not recorded)");

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
      return NextResponse.json({ success: false, error: "claude_error" }, { status: 502 });
    }

    const data = await res.json();
    const draft = (data.content?.[0]?.text || "").trim();
    if (!draft) {
      return NextResponse.json({ success: false, error: "claude_error" }, { status: 502 });
    }

    return NextResponse.json({ success: true, draft });
  } catch (err) {
    console.error("draft-outreach fatal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "internal" }, { status: 500 });
  }
}
