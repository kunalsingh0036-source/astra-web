import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

/**
 * POST /api/push/test
 *
 * Asks the Python backend to broadcast a test notification to every
 * active subscription. Web-side has no crypto dependencies — the
 * backend owns the VAPID private key and does the signing.
 *
 * Env vars read per-request (not at module load) so a `.env.local`
 * change takes effect on the next request without a process restart.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const backend = streamUrl();
  const secret =
    process.env.ASTRA_SHARED_SECRET ||
    process.env.STREAM_SHARED_SECRET ||
    "";

  // Log the shape of what we're about to send so if 401 still happens
  // we know whether the secret was empty at request time vs. wrong.
  console.log(
    `[push-test] → ${backend} secret_len=${secret.length}`,
  );

  try {
    const r = await fetch(`${backend}/api/push/test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-astra-secret": secret } : {}),
      },
      body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.log(
        `[push-test] backend rejected ${r.status} body=${JSON.stringify(body).slice(0, 200)}`,
      );
      return Response.json(
        {
          error:
            body?.error ||
            body?.detail ||
            `backend HTTP ${r.status}${secret ? "" : " (web has no shared secret set)"}`,
        },
        { status: 502 },
      );
    }
    return Response.json({
      attempted: body.attempted ?? 0,
      delivered: body.delivered ?? 0,
      pruned: body.pruned ?? 0,
      detail:
        body.detail ||
        `sent ${body.delivered ?? 0} of ${body.attempted ?? 0}`,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
