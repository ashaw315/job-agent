import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { watchedCompanies } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

/**
 * GET /api/companies
 * List all watched companies, ordered by priority then name.
 */
export async function GET() {
  try {
    const data = await db
      .select()
      .from(watchedCompanies)
      .orderBy(asc(watchedCompanies.priority), asc(watchedCompanies.name));

    return NextResponse.json({ companies: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/companies
 * Add a new watched company.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, ats, board_url, custom_scraper, category, priority } = body;

    if (!name || !ats || !board_url) {
      return NextResponse.json(
        { error: "name, ats, and board_url are required" },
        { status: 400 }
      );
    }

    const [company] = await db
      .insert(watchedCompanies)
      .values({
        name,
        ats,
        boardUrl: board_url,
        customScraper: custom_scraper ?? null,
        category: category || null,
        priority: priority || 2,
        isActive: true,
      })
      .returning();

    return NextResponse.json({ company }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PATCH /api/companies
 * Update a watched company.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const safeUpdates: Record<string, unknown> = {};
    if ("name" in updates) safeUpdates.name = updates.name;
    if ("ats" in updates) safeUpdates.ats = updates.ats;
    if ("board_url" in updates) safeUpdates.boardUrl = updates.board_url;
    if ("custom_scraper" in updates) safeUpdates.customScraper = updates.custom_scraper;
    if ("category" in updates) safeUpdates.category = updates.category;
    if ("priority" in updates) safeUpdates.priority = updates.priority;
    if ("is_active" in updates) safeUpdates.isActive = updates.is_active;

    const [company] = await db
      .update(watchedCompanies)
      .set(safeUpdates)
      .where(eq(watchedCompanies.id, id))
      .returning();

    return NextResponse.json({ company });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/companies
 * Soft-delete (set is_active = false).
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const [company] = await db
      .update(watchedCompanies)
      .set({ isActive: false })
      .where(eq(watchedCompanies.id, id))
      .returning();

    return NextResponse.json({ company });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
