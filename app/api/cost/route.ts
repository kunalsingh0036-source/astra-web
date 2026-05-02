import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/cost?days=30
 *
 * Aggregates UsageEvent rows from astra's `usage_events` table. Returns:
 *   - totals over the window
 *   - today-only total
 *   - daily breakdown (for a sparkline)
 *
 * Single round-trip via UNION ALL so the UI gets everything it needs in
 * one call.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DailyRow = {
  day: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  turns: number;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 30)));
  const source = url.searchParams.get("source");

  const sourceFilter = source ? "AND source = $2" : "";
  const args = source ? [days, source] : [days];

  const pool = astraPool();
  try {
    const [totals, today, week, daily, byModel, bySource] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(cost_usd), 0)::float               AS cost_usd,
           COALESCE(SUM(input_tokens), 0)::bigint          AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::bigint         AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0)::bigint     AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
           COALESCE(SUM(duration_ms), 0)::bigint           AS duration_ms,
           COUNT(*)::bigint                                AS turns
         FROM usage_events
         WHERE ts >= NOW() - ($1::int || ' days')::interval ${sourceFilter}`,
        args,
      ),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
                COUNT(*)::bigint AS turns
         FROM usage_events
         WHERE ts >= date_trunc('day', NOW())`,
      ),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
                COUNT(*)::bigint AS turns
         FROM usage_events
         WHERE ts >= NOW() - INTERVAL '7 days'`,
      ),
      pool.query(
        `SELECT
           to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
           COALESCE(SUM(cost_usd), 0)::float       AS cost_usd,
           COALESCE(SUM(input_tokens), 0)::bigint  AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
           COUNT(*)::bigint                        AS turns
         FROM usage_events
         WHERE ts >= NOW() - ($1::int || ' days')::interval ${sourceFilter}
         GROUP BY 1
         ORDER BY 1 ASC`,
        args,
      ),
      pool.query(
        `SELECT
           COALESCE(models, 'unknown') AS model,
           COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
           COUNT(*)::bigint                  AS turns
         FROM usage_events
         WHERE ts >= NOW() - ($1::int || ' days')::interval ${sourceFilter}
         GROUP BY 1
         ORDER BY cost_usd DESC`,
        args,
      ),
      pool.query(
        `SELECT
           source,
           COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
           COUNT(*)::bigint                  AS turns
         FROM usage_events
         WHERE ts >= NOW() - ($1::int || ' days')::interval
         GROUP BY 1
         ORDER BY cost_usd DESC`,
        [days],
      ),
    ]);

    const t = totals.rows[0] ?? {};
    return Response.json({
      window_days: days,
      filter_source: source,
      total_cost_usd: Number(t.cost_usd ?? 0),
      today_cost_usd: Number(today.rows[0]?.cost_usd ?? 0),
      today_turns: Number(today.rows[0]?.turns ?? 0),
      week_cost_usd: Number(week.rows[0]?.cost_usd ?? 0),
      week_turns: Number(week.rows[0]?.turns ?? 0),
      input_tokens: Number(t.input_tokens ?? 0),
      output_tokens: Number(t.output_tokens ?? 0),
      cache_read_tokens: Number(t.cache_read_tokens ?? 0),
      cache_creation_tokens: Number(t.cache_creation_tokens ?? 0),
      duration_ms: Number(t.duration_ms ?? 0),
      turns: Number(t.turns ?? 0),
      daily: daily.rows.map(
        (r): DailyRow => ({
          day: String(r.day),
          cost_usd: Number(r.cost_usd),
          input_tokens: Number(r.input_tokens),
          output_tokens: Number(r.output_tokens),
          turns: Number(r.turns),
        }),
      ),
      by_model: byModel.rows.map((r) => ({
        model: String(r.model),
        cost_usd: Number(r.cost_usd),
        turns: Number(r.turns),
      })),
      by_source: bySource.rows.map((r) => ({
        source: String(r.source),
        cost_usd: Number(r.cost_usd),
        turns: Number(r.turns),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "db error";
    return Response.json({ error: message }, { status: 500 });
  }
}
