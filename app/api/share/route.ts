import type { NextRequest } from "next/server";

/**
 * POST /api/share — proxy from astra.thearrogantclub.com to astra-stream.
 *
 * The iOS Share Sheet extension hits whatever backend URL it was
 * paired with. Most users will set astra.thearrogantclub.com (the
 * memorable hostname). This route forwards the request to
 * stream.thearrogantclub.com / localhost:8700 where /api/share
 * actually lives.
 *
 * Auth: middleware lets the request through when it carries an
 * Authorization: Bearer header. The actual token validation
 * happens inside astra-stream against the share_tokens table.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.STREAM_URL || "http://localhost:8700";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return Response.json({ error: "missing bearer token" }, { status: 401 });
  }
  const ct = req.headers.get("content-type") ?? "";

  // Pass through both JSON and multipart bodies. We can't peek at the
  // body — Node fetch needs a fresh stream — so we read the raw bytes
  // and re-send. Cheap (kilobytes for text, low MB for images).
  const buf = Buffer.from(await req.arrayBuffer());

  try {
    const upstream = await fetch(`${BACKEND}/api/share`, {
      method: "POST",
      headers: {
        "content-type": ct,
        authorization: auth,
      },
      body: buf,
    });
    const text = await upstream.text();
    // Pass the upstream status + body through verbatim so the iOS
    // client gets the real error message from astra-stream.
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
