import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/research
 *
 * List research briefings, newest-first. Optional ?status= filter.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  topic: string;
  kind: string;
  status: string;
  gist: string | null;
  business_tags: string;
  model_used: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  action_item_count: number;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const businessTag = url.searchParams.get("business");

  const pool = astraPool();
  try {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (status !== "all") {
      args.push(status);
      where.push(`status = $${args.length}`);
    }
    if (businessTag) {
      args.push(`%${businessTag}%`);
      where.push(`business_tags LIKE $${args.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query<Row>(
      `SELECT
         id, topic, kind, status,
         NULLIF(TRIM(SUBSTRING(
           REGEXP_REPLACE(body_md, E'.*\\\\*\\\\*Gist\\\\.\\\\*\\\\*\\\\s*', '', 'n')
           FROM 1 FOR 320)), '') AS gist,
         business_tags, model_used, duration_ms,
         created_at, completed_at, error,
         jsonb_array_length(COALESCE(action_items, '[]'::jsonb)) AS action_item_count
       FROM research_briefings
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 50`,
      args,
    );
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
