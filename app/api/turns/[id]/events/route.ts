import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/turns/[id]/events?after=<ord>
 *
 * Read durable event log for one turn. Returns events with ord > after.
 * The browser polls this every ~500ms instead of consuming SSE — that
 * sidesteps Vercel's streaming maxDuration cap, Cloudflare Tunnel's
 * idle timeout, and every intermediate proxy. The agent runs server-
 * side regardless of whether anyone's polling.
 *
 * Each event row matches what event_emitter.py outputs minus the wire
 * format:
 *   { ord, event: "session"|"text_delta"|"tool_call"|... , payload, created_at }
 *
 * Response also carries the turn's current status so the browser knows
 * when to stop polling: status in {complete, failed, interrupted, timeout}
 * → no more events coming.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface EventRow {
  ord: number;
  event_name: string;
  payload: Record<string, unknown>;
  created_at: Date;
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
      max: 4,
      keepAlive: true,
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const turnId = parseInt(id, 10);
  if (!Number.isFinite(turnId) || turnId <= 0) {
    return Response.json({ error: "invalid turn id" }, { status: 400 });
  }
  const after = parseInt(
    req.nextUrl.searchParams.get("after") || "0",
    10,
  ) || 0;

  const p = pool();
  if (!p) {
    return Response.json(
      { error: "DATABASE_URL not set" },
      { status: 500 },
    );
  }

  try {
    // Read events + the turn's current status in parallel.
    const [eventsR, turnR] = await Promise.all([
      p.query<EventRow>(
        `SELECT ord, event_name, payload, created_at
         FROM turn_events
         WHERE turn_id = $1 AND ord > $2
         ORDER BY ord ASC
         LIMIT 500`,
        [turnId, after],
      ),
      p.query<{ status: string; duration_ms: number | null; error_message: string | null }>(
        `SELECT status, duration_ms, error_message
         FROM turns WHERE id = $1`,
        [turnId],
      ),
    ]);

    if (turnR.rowCount === 0) {
      return Response.json({ error: "turn not found" }, { status: 404 });
    }

    const turn = turnR.rows[0];
    const terminal = ["complete", "failed", "interrupted", "timeout"].includes(
      turn.status,
    );

    return Response.json({
      turn_id: turnId,
      status: turn.status,
      duration_ms: turn.duration_ms,
      error_message: turn.error_message,
      terminal,
      events: eventsR.rows.map((row) => ({
        ord: row.ord,
        event: row.event_name,
        payload: row.payload || {},
        created_at: toISO(row.created_at) ?? "",
      })),
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
