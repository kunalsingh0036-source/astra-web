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
