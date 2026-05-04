import type { NextRequest } from "next/server";
import { Pool } from "pg";

/**
 * POST /api/bridge/expand
 *
 * Append paths to the active bridge token's allowed_paths array.
 * Called by the InputLine when the user types something that matches
 * the recent-turns intercept pattern "expand bridge to <path>".
 *
 * The active token is the one with the most recent last_seen_at
 * inside the last 60 seconds — same heuristic the lean runtime uses
 * to route tool calls. If no daemon is online, returns 404.
 *
 * Body:
 *   { paths: string[] }
 *
 * Returns:
 *   { ok, token_id, added: string[], allowed_paths: string[] }
 *   { error } on failure
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

export async function POST(req: NextRequest) {
  let body: { paths?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  const incoming = (body.paths || [])
    .map((p) => String(p || "").trim())
    .filter((p) => p && p.startsWith("/"));
  if (incoming.length === 0) {
    return Response.json(
      { error: "no valid absolute paths in 'paths'" },
      { status: 400 },
    );
  }

  const p = pool();
  if (!p) {
    return Response.json({ error: "no DATABASE_URL" }, { status: 500 });
  }

  // Find the active bridge token
  const active = await p.query<{ id: number; allowed_paths: string[] }>(
    `SELECT id, allowed_paths
     FROM bridge_tokens
     WHERE revoked_at IS NULL
       AND last_seen_at IS NOT NULL
       AND last_seen_at > NOW() - INTERVAL '60 seconds'
     ORDER BY last_seen_at DESC
     LIMIT 1`,
  );
  if (active.rowCount === 0) {
    return Response.json(
      {
        error:
          "no active bridge daemon (no token with last_seen_at < 60s ago). " +
          "start the daemon on the mac first.",
      },
      { status: 404 },
    );
  }

  const tokenId = active.rows[0].id;
  const existing: string[] = Array.isArray(active.rows[0].allowed_paths)
    ? active.rows[0].allowed_paths
    : [];

  const existingNormSet = new Set(existing.map((s) => normPath(s)));
  const added: string[] = [];
  const finalAllowlist = [...existing];
  for (const path of incoming) {
    if (existingNormSet.has(normPath(path))) continue;
    finalAllowlist.push(path);
    existingNormSet.add(normPath(path));
    added.push(path);
  }

  if (added.length > 0) {
    await p.query(
      `UPDATE bridge_tokens SET allowed_paths = $1::jsonb WHERE id = $2`,
      [JSON.stringify(finalAllowlist), tokenId],
    );
  }

  return Response.json({
    ok: true,
    token_id: tokenId,
    added,
    allowed_paths: finalAllowlist,
  });
}

function normPath(p: string): string {
  // POSIX normalization: collapse double slashes, strip trailing slash
  // (except root). Matches Python's os.path.normpath enough for
  // dedup purposes.
  let out = p.replace(/\/+/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}
