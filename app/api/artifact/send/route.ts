import type { NextRequest } from "next/server";

/**
 * POST /api/artifact/send
 *
 * Sends a Draft artifact through the appropriate downstream agent:
 *   - channel "email"    → email-agent  POST /messages/send
 *   - channel "whatsapp" → whatsapp-gateway POST /api/v1/send
 *
 * Accepts the same shape as DraftArtifact plus the user's optional edits.
 * The user never sees our shared secret; we add it server-side.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendBody = {
  channel: "email" | "whatsapp" | string;
  to: string;
  cc?: string;
  subject?: string;
  body: string;
  /** Optional WhatsApp template name. When set, we dispatch a
   *  template message instead of a free-text one (required when the
   *  24-hour customer session window is closed). */
  template_name?: string;
  template_language?: string;
};

export async function POST(req: NextRequest) {
  let payload: SendBody;
  try {
    payload = (await req.json()) as SendBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (!payload.to || !payload.body) {
    return Response.json(
      { error: "missing fields: to and body are required" },
      { status: 400 },
    );
  }

  const channel = (payload.channel ?? "email").toLowerCase();

  if (channel === "email") {
    const emailUrl = process.env.EMAIL_URL ?? "http://localhost:8005";
    try {
      // email-agent expects list[str] for to/cc/bcc. Split on comma so
      // the UI can still show "a@x.com, b@x.com" but we hand the agent
      // a clean array.
      const toList = payload.to
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const ccList = (payload.cc ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const up = await fetch(`${emailUrl}/api/v1/messages/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: toList,
          cc: ccList,
          bcc: [],
          subject: payload.subject ?? "",
          body: payload.body,
        }),
        cache: "no-store",
      });
      const text = await up.text();
      return new Response(text, {
        status: up.status,
        headers: { "content-type": up.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "email agent unreachable";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  if (channel === "whatsapp") {
    const waUrl = process.env.WHATSAPP_URL ?? "http://localhost:8600";
    // Build body depending on whether the caller wants a free-text
    // message (inside the 24h window) or a template send.
    const waBody = payload.template_name
      ? {
          agent_name: "astra",
          phone: payload.to,
          message_type: "template",
          template_name: payload.template_name,
          template_language: payload.template_language ?? "en_US",
        }
      : {
          agent_name: "astra",
          phone: payload.to,
          message_type: "text",
          content: payload.body,
        };
    try {
      const up = await fetch(`${waUrl}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(waBody),
        cache: "no-store",
      });
      const text = await up.text();
      return new Response(text, {
        status: up.status,
        headers: { "content-type": up.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "whatsapp gateway unreachable";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  return Response.json(
    { error: `channel '${channel}' not supported yet` },
    { status: 400 },
  );
}
