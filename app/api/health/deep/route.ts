import type { NextRequest } from "next/server";
import { Pool } from "pg";

/**
 * GET /api/health/deep
 *
 * Comprehensive system health check. Probes every dependency Astra
 * relies on, returns a structured report so we can see at a glance
 * what's degraded BEFORE typing a prompt and waiting for a failure.
 *
 * Replaces the "discover problems by hitting them" model.
 *
 * Probed:
 *   - Postgres reachable (round-trip query)
 *   - Latest migration applied
 *   - Anthropic API key set
 *   - Stream service reachable + healthy
 *   - Bridge daemon online (most-recent token's last_seen_at)
 *   - Turns table populated
 *
 * Each probe has a timeout. If anything's stuck, the endpoint
 * returns within ~5s with a clear "degraded" result rather than
 * hanging the whole health check.
 *
 * Output shape:
 *   {
 *     status: "ok" | "degraded" | "down",
 *     probedAt: ISO timestamp,
 *     checks: { name, status, detail?, duration_ms }[],
 *   }
 *
 * Public — no auth required so monitoring (UptimeRobot, GitHub
 * Actions, etc.) can hit it without credentials. The detail
 * payloads are intentionally non-sensitive.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface CheckResult {
  name: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
  duration_ms: number;
}

let _pool: Pool | null = null;
function pool(): Pool | null {
  if (_pool) return _pool;
  let url = (process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  url = url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
  try {
    _pool = new Pool({
      connectionString: url,
      ssl: url.includes("sslmode=")
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

// Each probe wraps work in a per-check timeout so a stuck dependency
// can't hang the whole health endpoint.
async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
): Promise<T | null> {
  return Promise.race([
    fn(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// ── Individual checks ─────────────────────────────────────

async function checkPostgres(): Promise<CheckResult> {
  const started = Date.now();
  const p = pool();
  if (!p) {
    return {
      name: "postgres",
      status: "down",
      detail: "DATABASE_URL not set",
      duration_ms: 0,
    };
  }
  const result = await withTimeout(async () => {
    const r = await p.query("SELECT 1 AS ok");
    return r.rows[0]?.ok === 1;
  }, 3000);
  const duration = Date.now() - started;
  if (result === null) {
    return {
      name: "postgres",
      status: "down",
      detail: "timed out",
      duration_ms: duration,
    };
  }
  return {
    name: "postgres",
    status: result ? "ok" : "degraded",
    duration_ms: duration,
  };
}

// Migration head + Anthropic key checks have moved to the stream
// service's /health/deep endpoint, where they belong:
//   - The stream container has the migration files copied in, so
//     it can compare DB-head vs disk-head (the truth). Vercel
//     can't do that — no migration files in its build.
//   - The Anthropic key lives in Railway's env, not Vercel's.
//     Probing process.env on Vercel was checking the wrong layer.
//
// astra-web's /api/health/deep now proxies the stream service's
// /health/deep and merges its checks into the response. See
// checkStreamServiceDeep below.

async function checkStreamService(): Promise<CheckResult> {
  const started = Date.now();
  const url = (process.env.ASTRA_STREAM_URL || "").trim();
  if (!url) {
    return {
      name: "stream_service",
      status: "down",
      detail: "ASTRA_STREAM_URL not set",
      duration_ms: 0,
    };
  }
  const result = await withTimeout(async () => {
    try {
      const r = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) return { ok: false, status: r.status };
      const body = (await r.json()) as { status?: string };
      return { ok: body.status === "healthy", status: r.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, 4000);
  const duration = Date.now() - started;
  if (!result) {
    return {
      name: "stream_service",
      status: "down",
      detail: "timed out",
      duration_ms: duration,
    };
  }
  if (!result.ok) {
    return {
      name: "stream_service",
      status: "down",
      detail: `unreachable: ${"status" in result ? `HTTP ${result.status}` : result.error}`,
      duration_ms: duration,
    };
  }
  return {
    name: "stream_service",
    status: "ok",
    detail: `${url} healthy`,
    duration_ms: duration,
  };
}

interface StreamDeepCheck {
  name: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
}

async function checkStreamDeep(): Promise<CheckResult[]> {
  /**
   * Pull the stream service's /health/deep response and unfold its
   * inner checks into our own list. This is where:
   *   - anthropic_key
   *   - database_url
   *   - migration_head (compared against on-disk migration files)
   * actually live. Vercel can't probe these directly because the
   * env vars + files are on Railway, not in Vercel's build.
   */
  const started = Date.now();
  const url = (process.env.ASTRA_STREAM_URL || "").trim();
  if (!url) {
    return [
      {
        name: "stream_deep",
        status: "down",
        detail: "ASTRA_STREAM_URL not set",
        duration_ms: 0,
      },
    ];
  }
  const result = await withTimeout(async () => {
    try {
      const r = await fetch(`${url}/health/deep`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) return null;
      return (await r.json()) as { checks?: StreamDeepCheck[] };
    } catch {
      return null;
    }
  }, 5000);
  const duration = Date.now() - started;
  if (!result || !Array.isArray(result.checks)) {
    return [
      {
        name: "stream_deep",
        status: "degraded",
        detail: "stream /health/deep unreachable",
        duration_ms: duration,
      },
    ];
  }
  // Unfold each inner check as a top-level entry. Prefix with
  // "stream:" so it's clear they originated upstream.
  return result.checks.map((c) => ({
    name: `stream:${c.name}`,
    status: c.status,
    detail: c.detail,
    duration_ms: duration,  // shared (single round-trip)
  }));
}

async function checkBridgeDaemon(): Promise<CheckResult> {
  const started = Date.now();
  const p = pool();
  if (!p) {
    return {
      name: "bridge_daemon",
      status: "down",
      detail: "no DB",
      duration_ms: 0,
    };
  }
  const result = await withTimeout(async () => {
    const r = await p.query<{ id: number; label: string; last_seen_at: Date }>(
      `SELECT id, label, last_seen_at
       FROM bridge_tokens
       WHERE revoked_at IS NULL
         AND last_seen_at IS NOT NULL
         AND last_seen_at > NOW() - INTERVAL '60 seconds'
       ORDER BY last_seen_at DESC
       LIMIT 1`,
    );
    return r.rows[0] || null;
  }, 3000);
  const duration = Date.now() - started;
  if (!result) {
    return {
      name: "bridge_daemon",
      status: "degraded",
      detail: "no daemon polled in last 60s — local_* tools unavailable",
      duration_ms: duration,
    };
  }
  return {
    name: "bridge_daemon",
    status: "ok",
    detail: `token #${result.id} (${result.label})`,
    duration_ms: duration,
  };
}

async function checkTurnsTable(): Promise<CheckResult> {
  const started = Date.now();
  const p = pool();
  if (!p) {
    return {
      name: "turns_table",
      status: "down",
      detail: "no DB",
      duration_ms: 0,
    };
  }
  const result = await withTimeout(async () => {
    const r = await p.query<{ count: number; oldest: Date | null }>(
      `SELECT COUNT(*)::int AS count, MIN(started_at) AS oldest FROM turns`,
    );
    return r.rows[0] || null;
  }, 3000);
  const duration = Date.now() - started;
  if (!result) {
    return {
      name: "turns_table",
      status: "down",
      detail: "table missing or query timed out",
      duration_ms: duration,
    };
  }
  return {
    name: "turns_table",
    status: "ok",
    detail: `${result.count} turn(s) recorded`,
    duration_ms: duration,
  };
}

// ── Runner ────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  // Fire all probes in parallel. Stream-deep returns a LIST (one
  // CheckResult per upstream check), the others return a single
  // CheckResult — flatten on join.
  const [pg, stream, bridge, turns, streamDeep] = await Promise.all([
    checkPostgres(),
    checkStreamService(),
    checkBridgeDaemon(),
    checkTurnsTable(),
    checkStreamDeep(),
  ]);
  const checks: CheckResult[] = [pg, stream, ...streamDeep, bridge, turns];

  const anyDown = checks.some((c) => c.status === "down");
  const anyDegraded = checks.some((c) => c.status === "degraded");
  const status: "ok" | "degraded" | "down" = anyDown
    ? "down"
    : anyDegraded
      ? "degraded"
      : "ok";

  return Response.json(
    {
      status,
      probedAt: new Date().toISOString(),
      checks,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
