import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/sessions/[id]
 *
 * Returns the full turn history for one session — every turn's prompt,
 * response, status, timestamps, tool count. Ordered chronologically
 * so the client can render the conversation top-to-bottom.
 *
 * Used by the /sessions list when the user picks a session to resume:
 * we load the turns into ChatProvider's history state and set
 * sessionRef.current so the next ask() flows under that session_id.
 * The lean runtime then loads the full message stack from
 * turns.messages on the server side for proper context.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TurnRow {
  id: number;
  prompt: string;
  response: string | null;
  status: string;
  tool_count: number;
  duration_ms: number | null;
  cost_usd: string | null;
  started_at: Date;
  ended_at: Date | null;
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = String(id || "").trim();
  if (!sessionId) {
    return Response.json({ error: "session id required" }, { status: 400 });
  }

  const p = pool();
  if (!p) return Response.json({ session_id: sessionId, turns: [] });

  try {
    const r = await p.query<TurnRow>(
      `SELECT id, prompt, response, status, tool_count,
              duration_ms, cost_usd::text, started_at, ended_at
       FROM turns
       WHERE session_id = $1
       ORDER BY started_at ASC`,
      [sessionId],
    );
    return Response.json({
      session_id: sessionId,
      turns: r.rows.map((row) => ({
        id: Number(row.id),
        prompt: row.prompt,
        response: row.response,
        status: row.status,
        tool_count: Number(row.tool_count || 0),
        duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
        cost_usd: row.cost_usd,
        started_at: toISO(row.started_at) ?? "",
        ended_at: toISO(row.ended_at),
      })),
    });
  } catch (e) {
    return Response.json(
      {
        session_id: sessionId,
        turns: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
