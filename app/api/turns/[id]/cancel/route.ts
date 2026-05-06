import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

/**
 * POST /api/turns/[id]/cancel
 *
 * Thin reverse-proxy that asks astra-stream to cancel an in-flight
 * turn. Same proxy pattern as /api/chat — keeps the stream service
 * URL invisible to the browser and lets us layer auth in without
 * touching the Python side.
 *
 * The stream service holds an asyncio.Task per running turn in a
 * dict; cancel() flips the task into the CancelledError path which
 * then writes status='interrupted' and exits cleanly.
 *
 * Best effort: if the upstream is unreachable we still return 200.
 * The browser already aborted its own polling loop locally, so the
 * UX is correct either way — the in-flight server-side run just
 * keeps spending tokens until it finishes naturally. That's a
 * smaller harm than blocking the user's "stop" gesture on a network
 * round-trip to a service that's hung anyway.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 5s — cancel is a one-off "set a flag" call. If it hangs longer
// than that, the stream service is wedged and we don't want the
// user's UI to wait on it.
export const maxDuration = 5;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const turnId = parseInt(id, 10);
  if (!Number.isFinite(turnId) || turnId <= 0) {
    return Response.json({ error: "invalid turn id" }, { status: 400 });
  }

  const streamBase = streamUrl();
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sharedSecret) headers["x-astra-secret"] = sharedSecret;

  try {
    const upstream = await fetch(`${streamBase}/turns/${turnId}/cancel`, {
      method: "POST",
      headers,
      cache: "no-store",
      // Strict timeout — see best-effort note in module docstring.
      signal: AbortSignal.timeout(3000),
    });
    if (!upstream.ok) {
      // Surface the status but don't fail loudly. Common cases:
      //   404 — turn already finished/swept (NOT an error from the
      //         user's POV; their cancel arrived after completion)
      //   502 — stream service hiccup; client polling will still
      //         observe terminal status either way
      return Response.json(
        {
          ok: false,
          upstream_status: upstream.status,
        },
        { status: 200 },
      );
    }
    const body = await upstream.json().catch(() => ({}));
    return Response.json({ ok: true, ...body });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "upstream unreachable",
      },
      { status: 200 },
    );
  }
}
