import type { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * /api/autonomy
 *
 * GET  → current autonomy mode string (from astra-control override
 *        file or the default).
 * POST → set the mode. Body: { mode: "always_ask" | "semi_auto" | "full_auto" }.
 *
 * The mode is persisted to a file astra-stream reads before each chat
 * turn and passes to the Agent SDK subprocess via its env dict. Next
 * turn picks up the new mode; no restart needed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODE_FILE =
  "/Users/kunalsingh/Claude Code/astra-control/autonomy_mode.txt";
const ALLOWED = new Set(["always_ask", "semi_auto", "full_auto"]);
const DEFAULT_MODE = "semi_auto";

async function readMode(): Promise<string> {
  try {
    const raw = (await fs.readFile(MODE_FILE, "utf8")).trim();
    return ALLOWED.has(raw) ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
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
  try {
    await fs.mkdir(path.dirname(MODE_FILE), { recursive: true });
    await fs.writeFile(MODE_FILE, mode, "utf8");
    return Response.json({ mode, saved: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
