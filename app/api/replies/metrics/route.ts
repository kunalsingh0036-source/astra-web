import type { NextRequest } from "next/server";
import { emailUrl, meshHeaders } from "@/lib/agentUrls";

/**
 * GET /api/replies/metrics — the inbox beachhead's value number
 * (draft-sent rate + time saved). Proxies email-agent /drafts/metrics.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(90, Number(url.searchParams.get("days") ?? 7)),
  );
  const base = emailUrl();
  try {
    const up = await fetch(`${base}/api/v1/drafts/metrics?days=${days}`, {
      cache: "no-store",
      headers: meshHeaders(),
    });
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
