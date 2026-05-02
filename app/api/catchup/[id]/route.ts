import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET    /api/catchup/[id]         — fetch one approval row
 * POST   /api/catchup/[id]/approve — flip status to 'approved'
 * POST   /api/catchup/[id]/reject  — flip status to 'rejected'
 *
 * The approve flip is the permission signal; the scheduler's
 * apply_approved_catchups job (every 60s) picks it up and performs
 * the AppleScript writeback. Rejections are terminal.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  reply_id: string;
  decrements: Record<string, number>;
  before_counters: Record<string, number | null>;
  projected_after: Record<string, number | null>;
  hours_reported: Record<string, number> | null;
  status: string;
  created_at: string;
  approved_at: string | null;
  applied_at: string | null;
  error: string | null;
};

export async function GET(
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
    const { rows } = await pool.query<Row>(
      `SELECT id, reply_id, decrements, before_counters,
              projected_after, hours_reported, status,
              created_at, approved_at, applied_at, error
       FROM catchup_approvals
       WHERE id = $1`,
      [numId],
    );
    if (rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
