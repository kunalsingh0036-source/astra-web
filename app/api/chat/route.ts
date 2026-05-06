import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

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

// PHASE 2B — this route returns a turn_id in <100ms.
//
// The browser polls /api/turns/<id>/events for progress +
// completion. No SSE in the path; no Vercel/Cloudflare/proxy
// duration cap mattering. The agent runs server-side regardless
// of whether anyone's polling — durable in turns + turn_events.
//
// maxDuration is intentionally low (10s). If it ever fires here,
// the round-trip to /turns/start on the stream service has hung —
// surface that as an error fast instead of letting Vercel kill it
// at the 300s wall.
//
// USE_LEGACY_SSE=1 env var falls back to the previous SSE-proxy
// path for rollback safety. Will be deleted after polling has run
// a week without regressions.
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const streamBase = streamUrl();
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  let body: { prompt?: unknown; session_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const sessionId =
    typeof body.session_id === "string" && body.session_id.length > 0
      ? body.session_id
      : null;

  if (!prompt.trim()) {
    return Response.json({ error: "prompt is empty" }, { status: 400 });
  }

  const upstreamBody: Record<string, unknown> = { prompt };
  if (sessionId) upstreamBody.session_id = sessionId;

  const upstreamHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sharedSecret) {
    upstreamHeaders["x-astra-secret"] = sharedSecret;
  }

  // Legacy SSE fallback path. Set USE_LEGACY_SSE=1 to revert to
  // the streaming model in case polling has an unforeseen issue.
  if (process.env.USE_LEGACY_SSE === "1") {
    return await proxyLegacyStream(streamBase, upstreamHeaders, upstreamBody);
  }

  // POLLING PATH — POST /turns/start on the stream service. Returns
  // {turn_id, session_id, status}. Browser polls /api/turns/[id]/events
  // for progress until terminal status.
  let upstream: Response;
  try {
    upstream = await fetch(`${streamBase}/turns/start`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      // Don't use Vercel's maxDuration as the only fence — be
      // explicit about how long we'll wait for /turns/start to
      // respond. It's supposed to return in <100ms.
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "upstream unreachable";
    return Response.json(
      { error: `stream service unreachable: ${message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => "");
    return Response.json(
      {
        error: `stream service ${upstream.status}: ${errBody.slice(0, 500)}`,
      },
      { status: 502 },
    );
  }

  const result = (await upstream.json()) as {
    turn_id?: number;
    session_id?: string | null;
    status?: string;
  };
  if (!result.turn_id) {
    return Response.json(
      { error: "stream service didn't return turn_id" },
      { status: 502 },
    );
  }

  return Response.json({
    turn_id: result.turn_id,
    session_id: result.session_id ?? null,
    status: result.status ?? "running",
  });
}

/**
 * Legacy SSE-proxy path, kept for env-var fallback (USE_LEGACY_SSE=1).
 * Will be deleted after polling has run a week without regressions.
 */
async function proxyLegacyStream(
  streamBase: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${streamBase}/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
