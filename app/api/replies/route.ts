import type { NextRequest } from "next/server";
import { emailUrl, meshHeaders } from "@/lib/agentUrls";

/**
 * GET /api/replies — the reply drafts waiting for Kunal.
 *
 * Proxies email-agent's GET /drafts/?status=ready. Kept behind our
 * auth boundary so the browser never learns the email-agent URL or
 * carries the mesh secret.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(50, Number(url.searchParams.get("limit") ?? 20)),
  );
  const base = emailUrl();
  try {
    const up = await fetch(
      `${base}/api/v1/drafts/?status=ready&limit=${limit}`,
      { cache: "no-store", headers: meshHeaders() },
    );
    const body = await up.text();
    return new Response(body, {
      status: up.status,
      headers: {
        "content-type":
          up.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "email agent unreachable" },
      { status: 502 },
    );
  }
}
