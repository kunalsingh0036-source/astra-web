/**
 * Canonical agent URL resolution.
 *
 * Every astra-web route that fetches an external agent (email,
 * whatsapp, finance, stream, etc.) goes through this module. Two
 * historical patterns this replaces:
 *
 *   1. Hardcoded `http://localhost:PORT` — wrong default for Vercel
 *      where loopback is unreachable. Caused "fetch failed" on the
 *      /email page and would have caused the same on whatsapp +
 *      finance routes once those features were exercised in prod.
 *
 *   2. Mixed env var names: STREAM_URL vs ASTRA_STREAM_URL — exactly
 *      the bug pattern documented in
 *      ~/.claude/.../learnings_railway_migration.md. Two routes read
 *      one, eleven the other; whichever Vercel didn't have set
 *      silently broke half the surface.
 *
 * Resolution rules per service:
 *   - The service-specific env var wins (lets a developer point at
 *     local/staging without touching code).
 *   - Falls back to the public Railway-edge hostname so production
 *     works out of the box without env vars set.
 *   - Localhost is NEVER the silent default. To run a local agent
 *     during dev, set the env var explicitly.
 *
 * If a hostname for a service doesn't exist yet (the service hasn't
 * been deployed to Railway), the helper returns null. Callers must
 * handle the null case — typically by returning a 503 from their
 * route. NEVER fabricate a URL.
 */

const STREAM_DEFAULT = "https://stream.thearrogantclub.com";
const EMAIL_DEFAULT = "https://email.thearrogantclub.com";
const WHATSAPP_DEFAULT = "https://whatsapp.thearrogantclub.com";

/**
 * Stream service (lean Astra agent runtime).
 *
 * Both ASTRA_STREAM_URL and STREAM_URL are honored — historical
 * drift had two routes using one and eleven using the other. New
 * code should set ASTRA_STREAM_URL; STREAM_URL is kept for env
 * back-compat. Update the user-facing docs (and Vercel env) to drop
 * STREAM_URL once we're confident no caller relies on it.
 */
export function streamUrl(): string {
  const fromEnv =
    (process.env.ASTRA_STREAM_URL || "").trim() ||
    (process.env.STREAM_URL || "").trim();
  return (fromEnv || STREAM_DEFAULT).replace(/\/+$/, "");
}

/** email-agent (port 8005 locally; Railway-deployed, custom domain). */
export function emailUrl(): string {
  const fromEnv = (process.env.EMAIL_URL || "").trim();
  return (fromEnv || EMAIL_DEFAULT).replace(/\/+$/, "");
}

/** whatsapp-gateway (port 8600 locally; Railway-deployed, custom domain). */
export function whatsappUrl(): string {
  const fromEnv = (process.env.WHATSAPP_URL || "").trim();
  return (fromEnv || WHATSAPP_DEFAULT).replace(/\/+$/, "");
}

/**
 * finance-agent. No public hostname yet — only set if FINANCE_URL is
 * configured (Vercel env points at a Railway internal address).
 * Returns null if unset; callers MUST handle this.
 */
export function financeUrl(): string | null {
  const fromEnv = (process.env.FINANCE_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

/** bookkeeper-agent (no public hostname; null if BOOKKEEPER_URL unset). */
export function bookkeeperUrl(): string | null {
  const fromEnv = (process.env.BOOKKEEPER_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

/** linkedin-agent (no public hostname; null if LINKEDIN_URL unset). */
export function linkedinUrl(): string | null {
  const fromEnv = (process.env.LINKEDIN_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

/** helmtech outreach agent (no public hostname; null if HELMTECH_URL unset). */
export function helmtechUrl(): string | null {
  const fromEnv = (process.env.HELMTECH_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

/** apex outreach agent (no public hostname; null if APEX_URL unset). */
export function apexUrl(): string | null {
  const fromEnv = (process.env.APEX_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

/**
 * Per-agent dispatch — used by the agent-status route to map
 * AgentName → URL. Returns null for agents whose URL isn't set;
 * the caller (lib/fleet.ts probe) treats that as "dim".
 */
export function urlForAgent(agent: string): string | null {
  switch (agent) {
    case "email":
      return emailUrl();
    case "whatsapp":
      return whatsappUrl();
    case "finance":
      return financeUrl();
    case "bookkeeper":
      return bookkeeperUrl();
    case "linkedin":
      return linkedinUrl();
    case "helmtech":
      return helmtechUrl();
    case "apex":
      return apexUrl();
    default:
      return null;
  }
}
