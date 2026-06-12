import { astraPool } from "@/lib/db";

/**
 * GET /api/approvals — pending approvals, newest first.
 *
 * The trust-staging surface: every row is a tool call the autonomy
 * gate paused for Kunal's yes/no. Resolution happens via
 * POST /api/approvals/[id]/resolve (web), the resolve_approval chat
 * tool, or WhatsApp ("approve 12").
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { rows } = await astraPool().query(
      `SELECT id, turn_id, tool_name, tool_input, reason, created_at
       FROM approvals
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 100`,
    );
    return Response.json({ approvals: rows });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "query failed" },
      { status: 500 },
    );
  }
}
