import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { watchedCompanies } from "@/lib/db/schema";
import { INITIAL_COMPANIES } from "@/lib/constants";

/**
 * POST /api/seed
 * Seeds watched_companies with the initial list.
 * Safe to call multiple times — uses onConflictDoNothing on board_url.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = INITIAL_COMPANIES.map((c) => ({
      name: c.name,
      ats: c.ats,
      boardUrl: c.board_url,
      category: c.category,
      priority: c.priority || 2,
      isActive: c.is_active ?? true,
    }));

    const result = await db
      .insert(watchedCompanies)
      .values(rows)
      .onConflictDoNothing({ target: watchedCompanies.boardUrl })
      .returning();

    return NextResponse.json({
      message: `Seeded ${result.length} new companies (${rows.length} total in list)`,
      companies: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
