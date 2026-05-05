import type { NextRequest } from "next/server";
import { Pool } from "pg";

/**
 * GET /api/turns/[id]
 *
 * Single-turn detail. Returns prompt, response, status, durations,
 * cost, plus the session_id so the page can deep-link back to the
 * full conversation. Used by the bookmarkable /turns/<id> page so
 * a specific run can be shared/referenced.
 *
 * Distinct from sibling routes at this segment:
 *   /api/turns/[id]/events  — durable event log for the polling loop
 *   /api/turns/[id]/cancel  — proxy to stream service's task.cancel()
 *
 * Doesn't hydrate the event log — that's the events endpoint's job.
 * If the page wants to show tool calls + thoughts, it can fetch
 * /api/turns/[id]/events?after=0 separately.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TurnDetailRow {
  id: number;
  session_id: string | null;
  prompt: string;
  response: string | null;
  status: string;
  tool_count: number;
  duration_ms: number | null;
  cost_usd: string | null;
  started_at: Date;
  ended_at: Date | null;
  error_message: string | null;
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
  const turnId = parseInt(id, 10);
  if (!Number.isFinite(turnId) || turnId <= 0) {
    return Response.json({ error: "invalid turn id" }, { status: 400 });
  }

  const p = pool();
  if (!p) {
    return Response.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }

  try {
    const r = await p.query<TurnDetailRow>(
      `SELECT id, session_id, prompt, response, status, tool_count,
              duration_ms, cost_usd::text, started_at, ended_at,
              error_message
       FROM turns
       WHERE id = $1`,
      [turnId],
    );
    if (r.rowCount === 0) {
      return Response.json({ error: "turn not found" }, { status: 404 });
    }
    const row = r.rows[0];
    return Response.json({
      id: Number(row.id),
      session_id: row.session_id,
      prompt: row.prompt,
      response: row.response,
      status: row.status,
      tool_count: Number(row.tool_count || 0),
      duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
      cost_usd: row.cost_usd,
      // pg driver returns Date for timestamp columns. Type the row
      // accordingly (Date / Date | null) and call toISOString
      // directly — no `instanceof Date` guard needed.
      started_at: row.started_at.toISOString(),
      ended_at: row.ended_at ? row.ended_at.toISOString() : null,
      error_message: row.error_message,
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
