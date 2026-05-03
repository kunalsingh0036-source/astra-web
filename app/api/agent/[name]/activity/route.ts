import type { NextRequest } from "next/server";
import { Pool } from "pg";
import type { AgentName } from "@/lib/types";

/**
 * GET /api/agent/[name]/activity
 *
 * Live activity feed for an agent room. Pulls from two Postgres tables:
 *
 *   - `audit_events` — every tool decision Astra made. We filter to
 *     ones that mention this agent (either via the MCP tool name or
 *     the tool_input_summary text), so the feed shows "things Astra
 *     did with this agent recently."
 *
 *   - `turns` — the new full-conversation log (added in migration
 *     n2g58h4f9c1c). We surface currently-running turns so the room
 *     can show "Astra is working on this RIGHT NOW" with the prompt
 *     visible. This is the heartbeat for "what is the agent doing?"
 *
 * The room polls this every ~5s. We cap returns to 30 events + 5 turns
 * to keep the payload small.
 *
 * Falls back to empty arrays (not 500) if the DB is unreachable —
 * the room still renders, just without live activity.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  name: string;
}

interface AuditEventRow {
  id: number;
  ts: string;
  tool_name: string;
  decision: string;
  action_tier: string;
  tool_input_summary: string;
}

interface TurnRow {
  id: number;
  session_id: string | null;
  prompt: string;
  response: string | null;
  status: string;
  tool_count: number;
  duration_ms: number | null;
  cost_usd: string | null;
  started_at: string;
  ended_at: string | null;
}

interface ActivityResponse {
  agent: AgentName;
  events: AuditEventRow[];
  runningTurns: TurnRow[];
  recentTurns: TurnRow[];
  probedAt: string;
}

// ── Agent → tool/text patterns ──────────────────────────────────────
//
// Each agent gets a list of LIKE patterns we OR together to match
// rows in audit_events. The patterns cover both the canonical MCP
// tool names (e.g. mcp__astra-email__*) and free-text mentions in
// the tool_input_summary so cross-agent calls (where Astra used a
// fleet/services tool that targeted this agent) still surface.

const AGENT_PATTERNS: Record<string, { tool: string[]; text: string[] }> = {
  email: {
    tool: ["mcp__astra-email__%"],
    text: ["%email%", "%inbox%", "%@%"],
  },
  finance: {
    tool: ["%finance%"],
    text: ["%finance%", "%invoice%", "%expense%", "%cash%", "%book%"],
  },
  whatsapp: {
    tool: ["%whatsapp%", "%astra-fleet%"],
    text: ["%whatsapp%", "%wa%message%", "%template%"],
  },
  bookkeeper: {
    tool: ["%bookkeeper%"],
    text: ["%bookkeeper%", "%ledger%", "%reconcil%", "%transaction%"],
  },
  linkedin: {
    tool: ["%linkedin%"],
    text: ["%linkedin%", "%post%", "%comment%"],
  },
  helmtech: {
    tool: ["%helmtech%"],
    text: ["%helmtech%", "%shotgun%", "%lead%"],
  },
  apex: {
    tool: ["%apex%"],
    text: ["%apex%", "%outreach%", "%cadence%"],
  },
};

// ── pg pool ─────────────────────────────────────────────────────────

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
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

// ── Query builders ──────────────────────────────────────────────────

async function recentEvents(
  p: Pool,
  patterns: { tool: string[]; text: string[] },
): Promise<AuditEventRow[]> {
  // Build an OR clause across all the LIKE patterns. We intentionally
  // include the past 24h — long enough to show the morning briefing
  // run alongside ad-hoc activity from the day, short enough to keep
  // the feed focused.
  const conds: string[] = [];
  const params: string[] = [];
  let i = 1;
  for (const t of patterns.tool) {
    conds.push(`tool_name ILIKE $${i++}`);
    params.push(t);
  }
  for (const t of patterns.text) {
    conds.push(`tool_input_summary ILIKE $${i++}`);
    params.push(t);
    conds.push(`context ILIKE $${i++}`);
    params.push(t);
  }
  if (conds.length === 0) return [];
  const where = conds.join(" OR ");
  const sql = `
    SELECT id, ts, tool_name, decision, action_tier,
           COALESCE(tool_input_summary, '') AS tool_input_summary
    FROM audit_events
    WHERE ts > NOW() - INTERVAL '24 hours'
      AND (${where})
    ORDER BY ts DESC
    LIMIT 30
  `;
  try {
    const r = await p.query(sql, params);
    return r.rows.map((row) => ({
      id: Number(row.id),
      ts: row.ts.toISOString(),
      tool_name: row.tool_name,
      decision: row.decision,
      action_tier: row.action_tier,
      tool_input_summary: row.tool_input_summary || "",
    }));
  } catch {
    return [];
  }
}

async function runningAndRecentTurns(
  p: Pool,
  patterns: { tool: string[]; text: string[] },
): Promise<{ running: TurnRow[]; recent: TurnRow[] }> {
  // Currently-running turns are surfaced regardless of whether they
  // mention the agent — better to over-show "something is happening
  // now" than miss it when a tool name doesn't match. The agent room
  // gives context.
  const running = await safeTurnQuery(
    p,
    `SELECT id, session_id, prompt, response, status, tool_count,
            duration_ms, cost_usd, started_at, ended_at
     FROM turns WHERE status = 'running'
     ORDER BY started_at DESC LIMIT 5`,
    [],
  );

  // Recent turns FILTERED by agent — we look in the prompt and the
  // response text for any of the agent's text patterns.
  const conds = patterns.text.map((_, idx) => `prompt ILIKE $${idx + 1} OR response ILIKE $${idx + 1}`);
  const recent =
    conds.length === 0
      ? []
      : await safeTurnQuery(
          p,
          `SELECT id, session_id, prompt, response, status, tool_count,
                  duration_ms, cost_usd, started_at, ended_at
           FROM turns
           WHERE status IN ('complete', 'failed', 'interrupted')
             AND started_at > NOW() - INTERVAL '24 hours'
             AND (${conds.join(" OR ")})
           ORDER BY started_at DESC
           LIMIT 10`,
          patterns.text,
        );

  return { running, recent };
}

async function safeTurnQuery(
  p: Pool,
  sql: string,
  params: string[],
): Promise<TurnRow[]> {
  try {
    const r = await p.query(sql, params);
    return r.rows.map((row) => ({
      id: Number(row.id),
      session_id: row.session_id,
      prompt: row.prompt,
      response: row.response,
      status: row.status,
      tool_count: Number(row.tool_count || 0),
      duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
      cost_usd: row.cost_usd ? String(row.cost_usd) : null,
      started_at:
        row.started_at instanceof Date
          ? row.started_at.toISOString()
          : String(row.started_at),
      ended_at:
        row.ended_at instanceof Date
          ? row.ended_at.toISOString()
          : row.ended_at,
    }));
  } catch {
    return [];
  }
}

// ── handler ─────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { name } = await params;
  const agent = name as AgentName;
  const patterns = AGENT_PATTERNS[agent];

  const empty: ActivityResponse = {
    agent,
    events: [],
    runningTurns: [],
    recentTurns: [],
    probedAt: new Date().toISOString(),
  };

  if (!patterns) {
    return Response.json(empty);
  }

  const p = pool();
  if (!p) {
    // No DB connection (local dev without DATABASE_URL or transient
    // outage). Return empty rather than 500 so the room still renders.
    return Response.json(empty);
  }

  const [events, turns] = await Promise.all([
    recentEvents(p, patterns),
    runningAndRecentTurns(p, patterns),
  ]);

  const out: ActivityResponse = {
    agent,
    events,
    runningTurns: turns.running,
    recentTurns: turns.recent,
    probedAt: new Date().toISOString(),
  };
  return Response.json(out);
}
