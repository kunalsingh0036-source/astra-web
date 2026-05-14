import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

/**
 * POST /api/uploads
 *
 * Accept a user-uploaded image (drag/drop/paste in the chat input)
 * and proxy it to the stream service's /uploads endpoint, which
 * stores it in the previews table base64-encoded and returns an id.
 *
 * Why proxy instead of direct browser → stream service:
 *   - Keeps the stream-service hostname invisible (same pattern as
 *     /api/chat, /api/preview/[id]).
 *   - Layers in the shared-secret server-side so the browser
 *     never needs to know it.
 *   - Auth gating happens at the Vercel/middleware layer for free.
 *
 * Constraints (enforced upstream too):
 *   - image/png | image/jpeg | image/webp | image/gif
 *   - <= 5MB
 *
 * Returns: { id, content_type, byte_count }
 *   - The browser stashes `id` and sends it on /api/chat's
 *     `attachments: []` array when the user hits send.
 *   - Renders thumbnail via <img src="/api/preview/<id>" /> — the
 *     existing preview-serving route, which now base64-decodes
 *     image/* responses.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const upstreamUrl = `${streamUrl()}/uploads`;
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  // Forward the multipart body verbatim. We can't re-marshal a
  // FormData because the boundary header would get lost; streaming
  // the raw body keeps the upload single-allocation.
  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  if (sharedSecret) headers["x-astra-secret"] = sharedSecret;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: req.body,
      // duplex required when streaming a body in Next 16's fetch
      // @ts-expect-error - duplex is a valid RequestInit option in
      // the Node fetch impl but missing from the DOM types.
      duplex: "half",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    return Response.json(
      {
        error: `upload upstream unreachable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 502 },
    );
  }

  // Pass upstream status + body through verbatim — error messages
  // there are already user-targeted (415 unsupported type, 413
  // too big, etc.) and worth surfacing as-is.
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") || "application/json",
    },
  });
}
