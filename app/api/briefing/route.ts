import { NextResponse } from "next/server";
import { astraPool } from "@/lib/db";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/briefing
 *
 * Returns the most recent briefing memory (written by the scheduler
 * `morning_briefing` job). If there isn't one yet, returns 404.
 *
 * `limit` query param controls how many historical briefings to
 * include (default 1, max 14). The most recent is first in the list.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(
    14,
    Math.max(1, Number(url.searchParams.get("limit") ?? 1)),
  );

  const pool = astraPool();
  try {
    const rows = await pool.query(
      `SELECT id, content, created_at, importance, tags
       FROM memories
       WHERE memory_type = 'EPISODIC' AND tags ILIKE '%briefing%'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );

    if (rows.rows.length === 0) {
      return NextResponse.json(
        {
          current: null,
          history: [],
          message:
            "No briefings yet. The scheduler writes one each morning; you can also fire one on demand.",
        },
        { status: 200 },
      );
    }

    const items = rows.rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      content: String(r.content ?? ""),
      created_at: toISO(r.created_at as Date | null) ?? "",
      importance: Number(r.importance ?? 0),
      tags: r.tags != null ? String(r.tags) : null,
    }));

    return NextResponse.json({
      current: items[0],
      history: items.slice(1),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "db error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
