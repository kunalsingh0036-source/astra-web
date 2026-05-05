import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/audit
 *
 * Returns the recent audit trail — every tool use, the autonomy mode
 * at the time, and the decision (allow / deny / ask).
 *
 * Query:
 *   limit=50             how many rows (max 500)
 *   decision=allow|deny|ask
 *   tier=read|write|communicate|privileged
 *   tool=<name>          substring filter on tool name
 *
 * Also returns a small stats payload for the /audit header: totals by
 * decision and tier, top 8 tools by frequency in the same window.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
  );
  const decision = url.searchParams.get("decision");
  const tier = url.searchParams.get("tier");
  const tool = url.searchParams.get("tool");

  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (decision) {
    args.push(decision);
    conditions.push(`decision = $${args.length}`);
  }
  if (tier) {
    args.push(tier);
    conditions.push(`action_tier = $${args.length}`);
  }
  if (tool) {
    args.push(`%${tool}%`);
    conditions.push(`tool_name ILIKE $${args.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const pool = astraPool();
  try {
    const [rows, stats, topTools] = await Promise.all([
      pool.query(
        `SELECT id, ts, tool_name, action_tier, autonomy_mode, decision,
                tool_input_summary, context
         FROM audit_events
         ${where}
         ORDER BY ts DESC
         LIMIT ${limit}`,
        args,
      ),
      pool.query(
        `SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE decision = 'allow')::bigint AS allowed,
           COUNT(*) FILTER (WHERE decision = 'deny')::bigint  AS denied,
           COUNT(*) FILTER (WHERE decision = 'ask')::bigint   AS asked
         FROM audit_events`,
      ),
      pool.query(
        `SELECT tool_name, COUNT(*)::bigint AS n
         FROM audit_events
         GROUP BY 1
         ORDER BY n DESC
         LIMIT 8`,
      ),
    ]);

    const s = stats.rows[0] ?? {};
    return Response.json({
      total: Number(s.total ?? 0),
      allowed: Number(s.allowed ?? 0),
      denied: Number(s.denied ?? 0),
      asked: Number(s.asked ?? 0),
      top_tools: topTools.rows.map((r) => ({
        tool: String(r.tool_name),
        n: Number(r.n),
      })),
      items: rows.rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        ts: toISO(r.ts as Date | null) ?? "",
        tool: String(r.tool_name ?? ""),
        tier: String(r.action_tier ?? ""),
        mode: String(r.autonomy_mode ?? ""),
        decision: String(r.decision ?? ""),
        summary: String(r.tool_input_summary ?? ""),
        context: String(r.context ?? ""),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "db error";
    return Response.json({ error: message }, { status: 500 });
  }
}
