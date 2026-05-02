import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * POST /api/catchup/[id]/reject
 *
 * Terminal: marks a pending row as 'rejected'. The scheduler ignores
 * rejected rows. Cannot be un-rejected; submit a new form to restart.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const pool = astraPool();
  try {
    const { rows } = await pool.query<{ status: string }>(
      `UPDATE catchup_approvals
       SET status = 'rejected'
       WHERE id = $1
         AND status = 'pending'
       RETURNING status`,
      [numId],
    );
    if (rows.length === 0) {
      const existing = await pool.query<{ status: string }>(
        `SELECT status FROM catchup_approvals WHERE id = $1`,
        [numId],
      );
      if (existing.rowCount === 0) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json(
        {
          error: `cannot reject — row is ${existing.rows[0].status}`,
          status: existing.rows[0].status,
        },
        { status: 409 },
      );
    }
    return Response.json({ id: numId, status: "rejected" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
