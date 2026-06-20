import type { NextRequest } from "next/server";
import { emailUrl, meshHeaders } from "@/lib/agentUrls";

/**
 * POST /api/replies/{id}/{action}
 *
 * Thin proxy to email-agent's draft actions:
 *   - send     body: { body_override?, subject_override? } → sends in-thread
 *   - refine   body: { instruction }                       → revises, no send
 *   - discard  (no body)                                    → marks discarded
 *
 * `send` is the only action that puts a real email in the world, and
 * it only fires from an explicit click on a specific draft — the
 * human-approval step of the inbox loop.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(["send", "refine", "discard"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ALLOWED.has(action)) {
    return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  // Pass through the JSON body for send/refine; discard needs none.
  let payload: unknown = undefined;
  if (action !== "discard") {
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
  }

  const base = emailUrl();
  try {
    const up = await fetch(`${base}/api/v1/drafts/${id}/${action}`, {
      method: "POST",
      cache: "no-store",
      headers: { ...meshHeaders(), "content-type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
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
