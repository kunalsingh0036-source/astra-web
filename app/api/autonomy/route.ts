import type { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * /api/autonomy
 *
 * GET  → current autonomy mode string (from override file or default).
 * POST → set the mode. Body: { mode: "always_ask" | "semi_auto" | "full_auto" }.
 *
 * The mode is persisted to a file astra-stream reads before each chat
 * turn. Path is env-driven (ASTRA_AUTONOMY_FILE) so the same code works
 * on Kunal's laptop AND on Railway, where the hardcoded laptop path
 * didn't exist (which is why UI toggles silently no-op'd in prod).
 *
 * Both this file (web) and astra-stream's runner.py read the SAME path.
 * Set ASTRA_AUTONOMY_FILE=/path/to/persistent/volume.txt on Railway and
 * mount the directory writable on both services.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function modeFilePath(): string {
  const env = (process.env.ASTRA_AUTONOMY_FILE || "").trim();
  if (env) return env;
  return path.join(os.homedir() || "/tmp", ".astra-state", "autonomy_mode.txt");
}

// Legacy laptop path — kept as a read-fallback so existing local installs
// keep working without env changes. Writes always go to the modern path.
const LEGACY_MODE_FILE =
  "/Users/kunalsingh/Claude Code/astra-control/autonomy_mode.txt";

const ALLOWED = new Set(["always_ask", "semi_auto", "full_auto"]);
const DEFAULT_MODE = "semi_auto";

async function readMode(): Promise<string> {
  for (const candidate of [modeFilePath(), LEGACY_MODE_FILE]) {
    try {
      const raw = (await fs.readFile(candidate, "utf8")).trim();
      if (ALLOWED.has(raw)) return raw;
    } catch {
      /* try next candidate */
    }
  }
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
  const target = modeFilePath();
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, mode, "utf8");
    return Response.json({ mode, saved: true, path: target });
  } catch (e) {
    const message = e instanceof Error ? e.message : "write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
