import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * POST /api/push/subscribe
 *
 * Browser sends its PushSubscription after a successful
 * PushManager.subscribe(). We upsert by endpoint — the same device/
 * browser re-subscribing just refreshes its keys.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  user_agent?: string;
  device_label?: string;
};

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { endpoint, p256dh, auth, user_agent, device_label } = body;
  if (!endpoint || !p256dh || !auth) {
    return Response.json(
      { error: "endpoint + p256dh + auth are required" },
      { status: 400 },
    );
  }

  const pool = astraPool();
  try {
    const { rows } = await pool.query<{ id: number; status: string }>(
      `INSERT INTO push_subscriptions
         (endpoint, p256dh, auth, user_agent, device_label, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             device_label = EXCLUDED.device_label,
             status = 'active',
             failure_count = 0,
             last_error = NULL,
             last_seen_at = now()
       RETURNING id, status`,
      [
        endpoint,
        p256dh,
        auth,
        (user_agent ?? "").slice(0, 2000),
        (device_label ?? "").slice(0, 255),
      ],
    );
    return Response.json({ id: rows[0].id, status: rows[0].status });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
