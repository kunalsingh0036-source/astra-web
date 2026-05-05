import type { NextRequest } from "next/server";

/**
 * POST /api/chat
 *
 * Thin reverse-proxy that forwards the browser's request to astra-stream
 * and pipes the SSE response back unchanged. Two reasons to proxy:
 *
 *   1. The browser never needs to know where astra-stream lives. We can
 *      move the stream service behind a Cloudflare Tunnel later with
 *      no client-side changes.
 *   2. Keeping it same-origin means we bypass CORS entirely and can
 *      layer auth in later without touching the Python side.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel streaming-function duration cap. Without this, the route
// inherits Vercel's default (60s on Hobby, ~60s baseline on Pro).
// Long agent turns — draft_doc + render_doc_pdf is 60-90s; multi-
// step research can run 3-4 minutes — get their connection killed
// mid-stream when the cap fires. The browser then sees a clean
// stream-close with no `done` event and surfaces "stream ended
// without a terminal event" (the synthetic error in chatStream.ts).
//
// 300s = 5 min, the Pro-plan streaming ceiling. On Hobby the cap is
// applied at the lower limit automatically — no harm in declaring
// the higher number.
//
// True fix is polling-based: return a turn_id immediately, browser
// polls /api/turns/<id> for progress + completion. Queued for a
// follow-up commit.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const streamUrl = process.env.ASTRA_STREAM_URL ?? "http://localhost:8700";
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  let body: { prompt?: unknown; session_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Normalize the session_id so upstream gets a clean string|null. This
  // also stops accidental leakage of arbitrary fields from the browser.
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const sessionId =
    typeof body.session_id === "string" && body.session_id.length > 0
      ? body.session_id
      : null;
  const upstreamBody: Record<string, unknown> = { prompt };
  if (sessionId) upstreamBody.session_id = sessionId;

  // Forward the shared secret so astra-stream accepts the call. The
  // browser never sees this secret — it lives server-side only and is
  // added here per request.
  const upstreamHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sharedSecret) {
    upstreamHeaders["x-astra-secret"] = sharedSecret;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${streamUrl}/stream`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      // Disable Next's default caching on RSC/fetch
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "upstream unreachable";
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
      {
        status: 502,
        headers: { "content-type": "text/event-stream" },
      },
    );
  }

  if (!upstream.body) {
    return new Response("no stream body", { status: 502 });
  }

  // Pipe the upstream stream through unchanged. Next.js/Node will
  // flush each chunk as it arrives.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
