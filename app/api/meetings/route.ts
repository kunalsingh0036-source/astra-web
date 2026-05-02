import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/meetings
 *
 * List recent meetings with state + minimal fields for the index page.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  title: string;
  recorded_at: string | null;
  duration_seconds: number | null;
  state: string;
  model_used: string;
  gist: string | null;
  task_count: number;
  created_at: string;
  error: string | null;
};

export async function GET(_req: NextRequest) {
  const pool = astraPool();
  try {
    const { rows } = await pool.query<Row>(
      `SELECT
         m.id, m.title, m.recorded_at, m.duration_seconds, m.state,
         m.model_used,
         NULLIF(SPLIT_PART(SPLIT_PART(m.summary, E'\\n', 1), '**Gist.** ', 2), '') AS gist,
         jsonb_array_length(COALESCE(m.task_ids, '[]'::jsonb)) AS task_count,
         m.created_at, m.error
       FROM meetings m
       ORDER BY COALESCE(m.recorded_at, m.created_at) DESC
       LIMIT 100`,
    );
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
