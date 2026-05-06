import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { toISO } from "@/lib/dbDate";

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
  first_turn_at: Date;
  last_turn_at: Date;
  turn_count: number;
  first_prompt: string;
  last_status: string;
  last_response_head: string | null;
  /** Haiku-generated topic title from session_titles. NULL when the
   *  background generator hasn't run yet (just-finished session) or
   *  when generation failed irrecoverably (rate limit, model
   *  deprecation). UI falls back to the truncated first_prompt. */
  title: string | null;
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
  // as the session's fallback title. The last turn's status indicates
  // whether the session is currently active or finished cleanly.
  //
  // LEFT JOIN session_titles to get the Haiku-generated topic title.
  // Filter (q) checks BOTH the title AND the first prompt so the
  // search bar finds sessions by topic OR by literal prompt content.
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
    SELECT
      sr.*,
      st.title
    FROM session_rollup sr
    LEFT JOIN session_titles st
      ON st.session_id = sr.session_id
    ${q ? "WHERE (st.title ILIKE $2 OR sr.first_prompt ILIKE $2)" : ""}
    ORDER BY sr.last_turn_at DESC
    LIMIT $1
  `;

  try {
    const params: unknown[] = [limit];
    if (q) params.push(`%${q}%`);
    const r = await p.query<SessionRow>(sql, params);
    return Response.json({
      sessions: r.rows.map((row) => ({
        session_id: row.session_id,
        first_turn_at: toISO(row.first_turn_at) ?? "",
        last_turn_at: toISO(row.last_turn_at) ?? "",
        turn_count: Number(row.turn_count || 0),
        first_prompt: row.first_prompt || "(empty prompt)",
        last_status: row.last_status || "unknown",
        last_response_head: row.last_response_head || null,
        title: row.title || null,
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
