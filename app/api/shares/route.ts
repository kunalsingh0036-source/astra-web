import { astraPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const pool = astraPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, source_app, source_url, title, text, note,
              file_path, mime_type, state, summary, action_taken,
              memory_id, task_ids, error, created_at, processed_at
       FROM shares
       ORDER BY created_at DESC
       LIMIT 100`,
    );
    return Response.json({ rows });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
