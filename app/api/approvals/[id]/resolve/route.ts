import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * POST /api/approvals/[id]/resolve
 * Body: { decision: "approved" | "denied", standing?: boolean }
 *
 * Mirrors astra.autonomy.approvals.resolve_approval exactly:
 * pending-only flip; standing approvals also upsert tool_grants
 * (per-tool auto-allow — the trust ladder's promotion step). Both
 * writers MUST stay in sync: the runtime consumes what either wrote.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const approvalId = Number(id);
  if (!Number.isInteger(approvalId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  let body: { decision?: unknown; standing?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const decision = body.decision === "approved" ? "approved"
    : body.decision === "denied" ? "denied" : null;
  if (!decision) {
    return Response.json(
      { error: "decision must be approved|denied" },
      { status: 400 },
    );
  }
  const standing = body.standing === true;

  const pool = astraPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE approvals
       SET status = $1, resolved_at = now(), standing = $2,
           resolution_source = 'web'
       WHERE id = $3 AND status = 'pending'
       RETURNING tool_name`,
      [decision, standing, approvalId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: `approval #${approvalId} not found or not pending` },
        { status: 404 },
      );
    }
    if (decision === "approved" && standing) {
      await client.query(
        `INSERT INTO tool_grants (tool_name, source, approval_id)
         VALUES ($1, 'web', $2)
         ON CONFLICT (tool_name) DO UPDATE
           SET granted_at = now(), source = 'web', approval_id = $2`,
        [rows[0].tool_name, approvalId],
      );
    }
    await client.query("COMMIT");
    return Response.json({
      ok: true,
      tool_name: rows[0].tool_name,
      decision,
      standing,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: e instanceof Error ? e.message : "resolve failed" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
