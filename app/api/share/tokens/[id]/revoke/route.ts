import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

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
    const r = await pool.query(
      `UPDATE share_tokens
       SET status = 'revoked', revoked_at = now()
       WHERE id = $1 AND status = 'active'`,
      [numId],
    );
    return Response.json({ ok: true, revoked: r.rowCount });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
