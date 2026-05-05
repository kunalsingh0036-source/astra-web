import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/turns/recent?limit=N
 *
 * Returns the most recent N chat turns directly from the `turns`
 * table — NO agent, NO LLM, NO MCP, NO subprocess. ~5ms.
 *
 * Why this exists separately from /api/chat:
 * "Pull up our last conversation" / "what was I just asking" etc. are
 * deterministic queries with a known SQL shape. Routing them through
 * the agent SDK was costing ~30s of LLM round-tripping (and 10+ failure
 * points) to do `SELECT * FROM turns LIMIT N`. Wrong tool for the job.
 *
 * The InputLine intercepts these natural-language phrases and hits this
 * endpoint, then injects the result into the chat as a synthetic turn
 * so the user still sees an answer in-place.
 *
 * Falls back to an empty list if DATABASE_URL is missing (local dev
 * without DB) — caller decides whether to surface an error.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TurnRow {
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
      // Same pre-ping motivation as the python side. Railway drops
      // idle TCP connections — without this we'd hand out dead pool
      // entries on long-quiet web containers.
      keepAlive: true,
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

export async function GET(req: NextRequest) {
  const limitRaw = req.nextUrl.searchParams.get("limit") || "1";
  const limit = Math.max(1, Math.min(20, parseInt(limitRaw, 10) || 1));

  const p = pool();
  if (!p) {
    return Response.json({ turns: [] as TurnRow[] });
  }

  try {
    const r = await p.query<TurnRow>(
      `SELECT id, session_id, prompt, response, status, tool_count,
              duration_ms, cost_usd::text, started_at, ended_at
       FROM turns
       WHERE status IN ('complete', 'failed', 'interrupted')
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit],
    );
    const rows = r.rows.map((row) => ({
      id: Number(row.id),
      session_id: row.session_id,
      prompt: row.prompt,
      response: row.response,
      status: row.status,
      tool_count: Number(row.tool_count || 0),
      duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
      cost_usd: row.cost_usd,
      started_at: toISO(row.started_at) ?? "",
      ended_at: toISO(row.ended_at),
    }));
    return Response.json({ turns: rows });
  } catch (e) {
    return Response.json(
      { turns: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
