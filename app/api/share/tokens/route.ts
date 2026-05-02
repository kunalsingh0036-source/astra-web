import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";
import crypto from "crypto";

/**
 * GET  /api/share/tokens — list every paired device + its state
 * POST /api/share/tokens — mint a new pairing token for a device label
 *
 * Both routes are behind the normal auth middleware, so only signed-in
 * sessions can mint/list tokens. Revoking lives at
 * /api/share/tokens/[id]/revoke.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const pool = astraPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, device_label, status, created_at,
              last_used_at, revoked_at
       FROM share_tokens
       ORDER BY created_at DESC
       LIMIT 50`,
    );
    return Response.json({ rows });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { device_label?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const label = (body.device_label ?? "iPhone").toString().slice(0, 255);

  // 32 random bytes, URL-safe base64. Matches the Python `secrets.token_urlsafe(32)`
  // used elsewhere in Astra.
  const token = crypto.randomBytes(32).toString("base64url");

  const pool = astraPool();
  try {
    const { rows } = await pool.query<{ id: number; created_at: string }>(
      `INSERT INTO share_tokens (token, device_label, status)
       VALUES ($1, $2, 'active')
       RETURNING id, created_at`,
      [token, label],
    );
    return Response.json({
      id: rows[0].id,
      token,
      device_label: label,
      created_at: rows[0].created_at,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
