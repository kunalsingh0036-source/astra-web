/**
 * Resolve the email-agent base URL.
 *
 * email-agent runs on Kunal's Mac at port 8005 (per
 * astra-control/bin/astra). On Vercel that loopback is unreachable —
 * the tunneled hostname `email.thearrogantclub.com` (configured in
 * astra-control/cloudflared/config.yml) is the public route.
 *
 * Two of the four email-talking routes used this pattern correctly
 * (artifact/send + message/[id]/[action]); two hardcoded localhost
 * (digest + unanswered) and silently failed in production with
 * "fetch failed". Centralizing here means the pattern can't drift —
 * one canonical resolver, all callers go through it.
 *
 * Env var precedence: EMAIL_URL wins (lets a developer point at any
 * staging instance). Falls back to the public tunnel hostname so
 * production "just works" without env config. Localhost is never the
 * fallback because it's the wrong default for the runtime that's
 * most likely to call this (Vercel serverless).
 */
export function emailAgentUrl(): string {
  const fromEnv = (process.env.EMAIL_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // Public tunnel — works from anywhere with internet (Vercel,
  // local dev, CI). Local dev that wants to hit a freshly-running
  // email-agent without the tunnel sets EMAIL_URL=http://localhost:8005.
  return "https://email.thearrogantclub.com";
}
