import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/calendar/proposals/bulk
 *
 * Body: { action: "approve" | "reject", ids: number[] }
 *
 * Used by the /calendar/propose page to bulk-apply the scaffold seed.
 */
type Body = {
  action?: "approve" | "reject";
  ids?: number[];
};

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
  if (!action || (action !== "approve" && action !== "reject")) {
    return Response.json({ error: "action must be approve|reject" }, { status: 400 });
  }
  if (ids.length === 0) {
    return Response.json({ error: "ids required" }, { status: 400 });
  }

  const pool = astraPool();
  try {
    if (action === "approve") {
      const { rows } = await pool.query<{ id: number }>(
        `UPDATE calendar_event_proposals
         SET status = 'approved',
             approved_at = COALESCE(approved_at, now())
         WHERE id = ANY($1::int[])
           AND status IN ('pending', 'approved')
         RETURNING id`,
        [ids],
      );
      return Response.json({
        action,
        applied_count: rows.length,
        ids: rows.map((r) => r.id),
      });
    }

    const { rows } = await pool.query<{ id: number }>(
      `UPDATE calendar_event_proposals
       SET status = 'rejected'
       WHERE id = ANY($1::int[])
         AND status = 'pending'
       RETURNING id`,
      [ids],
    );
    return Response.json({
      action,
      applied_count: rows.length,
      ids: rows.map((r) => r.id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
