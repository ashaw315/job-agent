import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import {
  eq,
  inArray,
  ilike,
  gte,
  or,
  desc,
  asc,
  sql,
  and,
} from "drizzle-orm";

/**
 * GET /api/jobs
 * Fetch jobs with filtering, sorting, and pagination.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Build conditions array
  const conditions = [];

  // Active filter (default: true)
  if (params.get("active") !== "false") {
    conditions.push(eq(jobs.isActive, true));
  }

  // Status filter (comma-separated)
  const status = params.get("status");
  if (status) {
    conditions.push(inArray(jobs.status, status.split(",")));
  }

  // Tier filter
  const tier = params.get("tier");
  if (tier) {
    conditions.push(eq(jobs.tier, parseInt(tier, 10)));
  }

  // Source filter
  const source = params.get("source");
  if (source) {
    conditions.push(eq(jobs.source, source));
  }

  // Company filter
  const company = params.get("company");
  if (company) {
    conditions.push(eq(jobs.companyName, company));
  }

  // Minimum score filter
  const minScore = params.get("min_score");
  if (minScore) {
    conditions.push(gte(jobs.keywordScore, parseFloat(minScore)));
  }

  // Search (title or company)
  const search = params.get("search");
  if (search) {
    conditions.push(
      or(
        ilike(jobs.title, `%${search}%`),
        ilike(jobs.companyName, `%${search}%`),
        ilike(jobs.companyDisplayName, `%${search}%`)
      )
    );
  }

  // Sort
  const sortField = params.get("sort") || "keyword_score";
  const sortOrder = params.get("order") || "desc";

  function getOrderBy() {
    const col = (() => {
      switch (sortField) {
        case "ai_score": return jobs.aiScore;
        case "date_scraped": return jobs.dateScraped;
        case "title": return jobs.title;
        case "company_name": return jobs.companyName;
        default: return jobs.keywordScore;
      }
    })();
    return sortOrder === "asc" ? asc(col) : desc(col);
  }

  // Pagination
  const limit = parseInt(params.get("limit") || "50", 10);
  const offset = parseInt(params.get("offset") || "0", 10);

  try {
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(where)
        .orderBy(getOrderBy())
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(where),
    ]);

    return NextResponse.json({
      jobs: data,
      total: Number(countResult[0]?.count || 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/jobs
 * Update one or more jobs.
 * Body: { ids: string[], updates: { status?, notes?, applied_date?, is_active?, tier?, role_category? } }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, updates } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }

    // Map incoming snake_case keys to Drizzle camelCase columns
    const safeUpdates: Record<string, unknown> = {};
    if ("status" in updates) safeUpdates.status = updates.status;
    if ("notes" in updates) safeUpdates.notes = updates.notes;
    if ("applied_date" in updates) safeUpdates.appliedDate = updates.applied_date ? new Date(updates.applied_date) : null;
    if ("is_active" in updates) safeUpdates.isActive = updates.is_active;
    if ("tier" in updates) safeUpdates.tier = updates.tier;
    if ("role_category" in updates) safeUpdates.roleCategory = updates.role_category;

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await db
      .update(jobs)
      .set(safeUpdates)
      .where(inArray(jobs.id, ids))
      .returning();

    return NextResponse.json({ updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
