import type { NextRequest } from "next/server";

/**
 * POST /api/tts  { text }  →  audio/mpeg
 *
 * Astra's actual voice. Proxies text to ElevenLabs (River by
 * default, ASTRA_VOICE_ID to change) and streams back mp3. The key
 * stays server-side — the browser never sees it.
 *
 * The web "listen" button calls this; on any failure it falls back
 * to the browser's speechSynthesis client-side, so the feature
 * degrades to robotic-but-working rather than silent.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const _VOICE = process.env.ASTRA_VOICE_ID || "SAz9YHcvj6GT2YYXdXww"; // River
// turbo_v2_5: lowest latency, good quality — right for an interactive
// "tap to hear" button where time-to-first-audio matters.
const _MODEL = "eleven_turbo_v2_5";
const _MAX_CHARS = 5000; // keep one tap cheap + fast

export async function POST(req: NextRequest) {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) {
    return Response.json({ error: "tts not configured" }, { status: 503 });
  }
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (typeof body.text === "string" ? body.text : "")
    .trim()
    .slice(0, _MAX_CHARS);
  if (!text) return Response.json({ error: "empty text" }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${_VOICE}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: _MODEL,
          voice_settings: { stability: 0.4, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch (e) {
    return Response.json(
      { error: `tts upstream unreachable: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: `tts ${upstream.status}: ${detail.slice(0, 160)}` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
