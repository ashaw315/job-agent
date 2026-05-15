import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

/**
 * GET /api/jobs/export
 * Streams the full jobs table as CSV. Browser downloads via Content-Disposition.
 */
export async function GET() {
  try {
    const rows = await db.select().from(jobs);
    if (rows.length === 0) {
      return new NextResponse("", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="jobs-${dateStamp()}.csv"`,
        },
      });
    }

    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(","),
      ...rows.map(r =>
        headers.map(h => csvCell((r as Record<string, unknown>)[h])).join(",")
      ),
    ];
    const body = lines.join("\n");

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="jobs-${dateStamp()}.csv"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  // RFC 4180: quote if contains comma, quote, newline, or carriage return; double up internal quotes
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
