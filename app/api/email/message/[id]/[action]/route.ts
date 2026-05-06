import type { NextRequest } from "next/server";
import { emailAgentUrl } from "@/lib/emailAgent";

/**
 * POST /api/email/message/{id}/{action}
 *
 * Thin proxy to email-agent's triage endpoints:
 *   - archive            → remove from INBOX
 *   - star  ?starred=1|0 → add/remove STARRED
 *   - mark_read          → remove UNREAD
 *
 * Kept behind our auth boundary so the browser never needs to know
 * email-agent's internal URL.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(["archive", "star", "mark_read"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ALLOWED.has(action)) {
    return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
  const url = new URL(req.url);
  const starred = url.searchParams.get("starred");
  const qs = starred !== null ? `?starred=${starred === "true" || starred === "1"}` : "";

  const emailUrl = emailAgentUrl();
  try {
    const up = await fetch(`${emailUrl}/api/v1/messages/${id}/${action}${qs}`, {
      method: "POST",
      cache: "no-store",
    });
    const body = await up.text();
    return new Response(body, {
      status: up.status,
      headers: { "content-type": up.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "email agent unreachable" },
      { status: 502 },
    );
  }
}
