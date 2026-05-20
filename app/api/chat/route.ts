import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

/**
 * POST /api/chat
 *
 * Enqueues a turn on the stream service and returns the turn_id.
 * The browser then polls /api/turns/<id>/events for progress until
 * the turn reaches a terminal state. No SSE in the path; no Vercel
 * / Cloudflare / proxy duration cap matters. The agent runs
 * server-side regardless of whether anyone's polling — durable in
 * the `turns` + `turn_events` tables.
 *
 * Why proxy at all (vs. browser → stream service direct):
 *   1. The browser never needs to know where the stream service
 *      lives. We can move it behind another tunnel later with no
 *      client-side changes.
 *   2. Same-origin means CORS isn't a concern, and we layer auth
 *      in middleware without touching the Python side.
 *
 * History: until 2026-05-20 this route also carried a USE_LEGACY_SSE
 * env-var fallback that proxied to the stream service's /stream SSE
 * endpoint. The SSE path was removed once polling had run >2 weeks
 * in prod without regression — rollback is now `git revert`, not a
 * runtime toggle.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// /turns/start is supposed to return in <100ms. If maxDuration ever
// fires here, the upstream call has hung — surface that as a 502 fast
// instead of letting Vercel kill it at the 300s wall.
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const streamBase = streamUrl();
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  let body: {
    prompt?: unknown;
    session_id?: unknown;
    attachments?: unknown;
  };
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
  // Attachments are upload IDs returned by POST /api/uploads. Only
  // accept strings here; anything else (number, object, array of
  // arrays) is rejected silently — the agent treats missing
  // attachments gracefully so we don't fail the turn over a bad
  // entry.
  const attachments: string[] = Array.isArray(body.attachments)
    ? body.attachments.filter(
        (a): a is string => typeof a === "string" && a.length > 0,
      )
    : [];

  if (!prompt.trim()) {
    return Response.json({ error: "prompt is empty" }, { status: 400 });
  }

  const upstreamBody: Record<string, unknown> = { prompt };
  if (sessionId) upstreamBody.session_id = sessionId;
  if (attachments.length > 0) upstreamBody.attachments = attachments;

  const upstreamHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sharedSecret) {
    upstreamHeaders["x-astra-secret"] = sharedSecret;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${streamBase}/turns/start`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      // Be explicit about how long we'll wait for /turns/start to
      // respond. It's supposed to return in <100ms. Don't lean on
      // Vercel's maxDuration as the only fence.
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
