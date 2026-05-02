import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { endpoint?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const endpoint = body.endpoint;
  if (!endpoint) {
    return Response.json({ error: "endpoint required" }, { status: 400 });
  }

  const pool = astraPool();
  try {
    await pool.query(
      `UPDATE push_subscriptions
       SET status = 'gone', last_error = 'user unsubscribed'
       WHERE endpoint = $1`,
      [endpoint],
    );
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
