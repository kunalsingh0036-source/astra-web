import type { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

/**
 * /api/autonomy
 *
 * GET  → current autonomy mode string (DB-backed in prod, file-backed locally).
 * POST → set the mode. Body: { mode: "always_ask" | "semi_auto" | "full_auto" }.
 *
 * Why DB instead of a file:
 * The web service and astra-stream are SEPARATE Railway containers
 * with their own ephemeral filesystems. A file written by /api/autonomy
 * was invisible to runner.py — that's why mode toggles silently no-op'd
 * in the screenshots. Both services already share Postgres via
 * DATABASE_URL, so the autonomy mode lives in the app_settings table
 * with key='autonomy_mode'. astra-stream/runner.py reads the same row.
 *
 * Local dev still works via the file fallback so no DB is required to
 * run on a single host.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(["always_ask", "semi_auto", "full_auto"]);
const DEFAULT_MODE = "semi_auto";

// ── pg pool, lazy-initialized once per cold-start ───────────────────

let _pool: Pool | null = null;
function pool(): Pool | null {
  if (_pool) return _pool;
  let url = (process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  // Railway hands out `postgresql://` URLs; node-postgres handles those
  // natively. The +asyncpg suffix some other Astra services use is for
  // SQLAlchemy's async engine and would confuse pg.
  url = url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
  try {
    _pool = new Pool({
      connectionString: url,
      // Railway-provided SSL certs aren't always trusted; the data
      // here is non-sensitive config state, so a relaxed SSL mode
      // is acceptable for this single endpoint.
      ssl: url.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
      max: 2,
    });
  } catch {
    _pool = null;
  }
  return _pool;
}

// ── File fallback for local dev (no DATABASE_URL) ───────────────────

function modeFilePath(): string {
  const env = (process.env.ASTRA_AUTONOMY_FILE || "").trim();
  if (env) return env;
  return path.join(os.homedir() || "/tmp", ".astra-state", "autonomy_mode.txt");
}

const LEGACY_MODE_FILE =
  "/Users/kunalsingh/Claude Code/astra-control/autonomy_mode.txt";

async function readFromFiles(): Promise<string | null> {
  for (const candidate of [modeFilePath(), LEGACY_MODE_FILE]) {
    try {
      const raw = (await fs.readFile(candidate, "utf8")).trim();
      if (ALLOWED.has(raw)) return raw;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function writeToFile(mode: string): Promise<void> {
  const target = modeFilePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, mode, "utf8");
}

// ── DB-backed read/write ────────────────────────────────────────────

async function readFromDb(): Promise<string | null> {
  const p = pool();
  if (!p) return null;
  try {
    const r = await p.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'autonomy_mode'",
    );
    const v = r.rows[0]?.value;
    if (v && ALLOWED.has(v)) return v;
  } catch {
    // Table missing or DB unreachable. Caller falls back to file.
  }
  return null;
}

async function writeToDb(mode: string): Promise<boolean> {
  const p = pool();
  if (!p) return false;
  try {
    await p.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('autonomy_mode', $1, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [mode],
    );
    return true;
  } catch {
    return false;
  }
}

// ── Public handlers ─────────────────────────────────────────────────

async function readMode(): Promise<string> {
  const db = await readFromDb();
  if (db) return db;
  const file = await readFromFiles();
  if (file) return file;
  return DEFAULT_MODE;
}

export async function GET() {
  const mode = await readMode();
  return Response.json({ mode });
}

export async function POST(req: NextRequest) {
  let body: { mode?: unknown };
  try {
    body = (await req.json()) as { mode?: unknown };
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!ALLOWED.has(mode)) {
    return Response.json(
      { error: `mode must be one of: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  // Try DB first (the only path that works cross-service on Railway).
  // Fall back to file for environments without DATABASE_URL (local
  // dev installs that haven't pointed at a DB).
  const dbOk = await writeToDb(mode);
  let fileOk = false;
  if (!dbOk) {
    try {
      await writeToFile(mode);
      fileOk = true;
    } catch {
      /* both failed — surface the error */
    }
  }

  if (!dbOk && !fileOk) {
    return Response.json(
      { error: "could not persist mode (no DB and no writable file path)" },
      { status: 500 },
    );
  }

  return Response.json({
    mode,
    saved: true,
    backend: dbOk ? "postgres" : "file",
  });
}
