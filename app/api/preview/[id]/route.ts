import type { NextRequest } from "next/server";
import { streamUrl } from "@/lib/agentUrls";

/**
 * GET /api/preview/[id]
 *
 * Same-origin proxy to the stream service's GET /previews/<id>.
 * Returns the preview body with its stored Content-Type so the
 * browser can render the asset natively in either an iframe (the
 * chat pane's inline preview) or a new tab (the artifact's "open
 * preview" button).
 *
 * Why proxy:
 *   - Iframe embed: the chat pane sets src="/api/preview/<id>",
 *     which is same-origin → no X-Frame-Options drama.
 *   - Auth: the route inherits NextAuth/middleware protection. If
 *     the user is signed out, the iframe gets a redirect to /signin
 *     (which they'd see as broken; that's acceptable since logged-
 *     out users shouldn't see chat artifacts anyway).
 *   - Hides the upstream URL — same logic as /api/chat etc.
 *
 * The route forwards the upstream's Content-Type, X-Frame-Options,
 * and CSP headers verbatim so the security model matches what the
 * stream service set.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[0-9a-fA-F-]{8,}$/.test(id)) {
    return new Response("invalid preview id", { status: 400 });
  }

  const streamBase = streamUrl();
  const sharedSecret = process.env.ASTRA_SHARED_SECRET ?? "";

  let upstream: Response;
  try {
    upstream = await fetch(`${streamBase}/previews/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: sharedSecret
        ? { "x-astra-secret": sharedSecret }
        : {},
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return new Response(
      `preview upstream unreachable: ${e instanceof Error ? e.message : "unknown"}`,
      { status: 502 },
    );
  }

  if (upstream.status === 404) {
    return new Response("preview not found or expired", { status: 404 });
  }
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return new Response(body || `upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  // Forward security-relevant headers from upstream verbatim. The
  // stream service set X-Frame-Options: SAMEORIGIN and a tight CSP;
  // we don't want to weaken those.
  const fwdHeaders: Record<string, string> = {};
  const ct = upstream.headers.get("content-type");
  if (ct) fwdHeaders["content-type"] = ct;
  for (const k of [
    "x-frame-options",
    "content-security-policy",
    "cache-control",
    "x-content-type-options",
  ]) {
    const v = upstream.headers.get(k);
    if (v) fwdHeaders[k] = v;
  }

  // Stream the body straight through — keeps memory flat for
  // large HTML and lets the browser start parsing immediately.
  return new Response(upstream.body, {
    status: 200,
    headers: fwdHeaders,
  });
}
