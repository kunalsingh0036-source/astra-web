import type { NextRequest } from "next/server";
import { Pool } from "pg";

/**
 * GET /api/sessions
 *
 * List distinct chat sessions (grouped by session_id) with summary
 * info — first prompt, last activity, turn count, last status. Newest
 * activity first. Used by the /sessions page to let the user browse
 * + resume past conversations.
 *
 * Query params:
 *   limit  — max sessions to return (default 50, max 200)
 *   q      — optional free-text filter applied to first prompt
 *
 * Skips rows with NULL session_id (those are pre-Phase-4 turns or
 * weird states that don't belong to any session).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SessionRow {
  session_id: string;
  first_turn_at: string;
  last_turn_at: string;
  turn_count: number;
  first_prompt: string;
  last_status: string;
  last_response_head: string | null;
}

let _pool: Pool | null = null;
function pool(): Pool | null {
  if (_pool) return _pool;
  let url = (process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  url = url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
  try {
    _pool = new Pool({
      connectionString: url,
      ssl: url.includes("sslmode=")
        ? undefined
        : { rejectUnauthorized: false },
      max: 3,
      keepAlive: true,
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

export async function GET(req: NextRequest) {
  const limitRaw = req.nextUrl.searchParams.get("limit") || "50";
  const limit = Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 50));
  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  const p = pool();
  if (!p) return Response.json({ sessions: [] });

  // GROUP BY session_id with windowed reads for first/last turn metadata.
  // We pull the first turn's prompt (chronologically first by started_at)
  // as the session's "title" — it usually summarizes what the chat is
  // about. The last turn's status indicates whether the session is
  // currently active or finished cleanly.
  const sql = `
    WITH session_rollup AS (
      SELECT
        session_id,
        MIN(started_at) AS first_turn_at,
        MAX(started_at) AS last_turn_at,
        COUNT(*)::int   AS turn_count,
        (
          SELECT prompt FROM turns t2
          WHERE t2.session_id = t.session_id
          ORDER BY t2.started_at ASC
          LIMIT 1
        ) AS first_prompt,
        (
          SELECT status FROM turns t3
          WHERE t3.session_id = t.session_id
          ORDER BY t3.started_at DESC
          LIMIT 1
        ) AS last_status,
        (
          SELECT LEFT(response, 240) FROM turns t4
          WHERE t4.session_id = t.session_id
            AND response IS NOT NULL
            AND response != ''
          ORDER BY t4.started_at DESC
          LIMIT 1
        ) AS last_response_head
      FROM turns t
      WHERE session_id IS NOT NULL
      GROUP BY session_id
    )
    SELECT *
    FROM session_rollup
    ${q ? "WHERE first_prompt ILIKE $2" : ""}
    ORDER BY last_turn_at DESC
    LIMIT $1
  `;

  try {
    const params: unknown[] = [limit];
    if (q) params.push(`%${q}%`);
    const r = await p.query<SessionRow>(sql, params);
    return Response.json({
      sessions: r.rows.map((row) => ({
        session_id: row.session_id,
        first_turn_at:
          row.first_turn_at instanceof Date
            ? row.first_turn_at.toISOString()
            : String(row.first_turn_at),
        last_turn_at:
          row.last_turn_at instanceof Date
            ? row.last_turn_at.toISOString()
            : String(row.last_turn_at),
        turn_count: Number(row.turn_count || 0),
        first_prompt: row.first_prompt || "(empty prompt)",
        last_status: row.last_status || "unknown",
        last_response_head: row.last_response_head || null,
      })),
    });
  } catch (e) {
    return Response.json(
      {
        sessions: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
