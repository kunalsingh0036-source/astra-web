import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/notes
 *
 * Lists Apple Notes from the synced mirror (apple_notes table).
 * Params:
 *   q=           substring search across title + body
 *   folder=      filter by folder name
 *   limit=       default 30, max 200
 *
 * Always returns stats so the UI can show folder counts + total.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const folder = url.searchParams.get("folder")?.trim();
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? 30)),
  );

  const pool = astraPool();
  try {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q) {
      args.push(`%${q}%`);
      args.push(`%${q}%`);
      where.push(`(title ILIKE $${args.length - 1} OR body_text ILIKE $${args.length})`);
    }
    if (folder) {
      args.push(folder);
      where.push(`folder = $${args.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows, stats, folders] = await Promise.all([
      pool.query(
        `SELECT id, apple_id, title, folder, char_count, tags,
                SUBSTRING(body_text FOR 500) AS preview,
                created_at_native, modified_at_native, last_synced_at
         FROM apple_notes
         ${whereClause}
         ORDER BY modified_at_native DESC NULLS LAST
         LIMIT ${limit}`,
        args,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(char_count), 0)::bigint AS total_chars,
                MAX(last_synced_at) AS last_synced
         FROM apple_notes`,
      ),
      pool.query(
        `SELECT folder, COUNT(*)::int AS n
         FROM apple_notes
         GROUP BY folder
         ORDER BY n DESC`,
      ),
    ]);

    return Response.json({
      stats: {
        total: Number(stats.rows[0]?.total ?? 0),
        total_chars: Number(stats.rows[0]?.total_chars ?? 0),
        last_synced:
          stats.rows[0]?.last_synced instanceof Date
            ? (stats.rows[0].last_synced as Date).toISOString()
            : stats.rows[0]?.last_synced ?? null,
      },
      by_folder: folders.rows.map((r) => ({
        folder: String(r.folder || "(none)"),
        n: Number(r.n),
      })),
      items: rows.rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        title: String(r.title ?? ""),
        folder: String(r.folder ?? ""),
        char_count: Number(r.char_count ?? 0),
        tags: String(r.tags ?? ""),
        preview: String(r.preview ?? ""),
        created_at:
          r.created_at_native instanceof Date
            ? (r.created_at_native as Date).toISOString()
            : (r.created_at_native as string | null) ?? null,
        modified_at:
          r.modified_at_native instanceof Date
            ? (r.modified_at_native as Date).toISOString()
            : (r.modified_at_native as string | null) ?? null,
      })),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
