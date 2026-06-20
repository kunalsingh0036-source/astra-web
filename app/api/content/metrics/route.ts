import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/content/metrics — the content beachhead's value number:
 * drafted / approved (=shipped) / posted / rejected / pending over the
 * window, plus approval rate + posts/week. Direct DB, mirrors
 * /api/research's pattern.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? 7)));
  const pool = astraPool();
  try {
    const { rows } = await pool.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n
         FROM creator_artifacts
        WHERE kind = 'linkedin_post'
          AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY status`,
      [String(days)],
    );
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = r.n;
    const posted = c["posted"] ?? 0;
    const approved = (c["approved"] ?? 0) + posted;
    const rejected = c["rejected"] ?? 0;
    const pending = c["pending_review"] ?? 0;
    const drafted = Object.values(c).reduce((a, b) => a + b, 0);
    const decided = approved + rejected;
    const approval_rate = decided ? Math.round((approved / decided) * 1000) / 1000 : null;
    const posts_per_week = Math.round((approved / days) * 7 * 10) / 10;
    return Response.json({
      window_days: days,
      drafted,
      approved,
      posted,
      rejected,
      pending,
      approval_rate,
      posts_per_week,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
