import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";
import { toISO } from "@/lib/dbDate";

/**
 * GET /api/notes/{id}
 * Returns the full body of one Apple Note.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const pool = astraPool();
  try {
    const r = await pool.query(
      `SELECT id, apple_id, title, folder, body_text, char_count, tags,
              created_at_native, modified_at_native, last_synced_at
       FROM apple_notes WHERE id = $1`,
      [idNum],
    );
    if (r.rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const n = r.rows[0];
    return Response.json({
      id: Number(n.id),
      apple_id: String(n.apple_id),
      title: String(n.title ?? ""),
      folder: String(n.folder ?? ""),
      body_text: String(n.body_text ?? ""),
      char_count: Number(n.char_count ?? 0),
      tags: String(n.tags ?? ""),
      created_at: toISO(n.created_at_native as Date | null),
      modified_at: toISO(n.modified_at_native as Date | null),
      last_synced: toISO(n.last_synced_at as Date | null),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
