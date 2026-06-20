import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/content
 *
 * List staged LinkedIn post drafts (creator_artifacts kind='linkedin_post',
 * status='pending_review'), newest-first. Direct DB read via the shared
 * astra pool — same pattern as /api/research.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  title: string;
  content: Record<string, unknown>;
  status: string;
  created_at: string;
};

export async function GET(_req: NextRequest) {
  const pool = astraPool();
  try {
    const { rows } = await pool.query<Row>(
      `SELECT id, title, content, status, created_at
         FROM creator_artifacts
        WHERE kind = 'linkedin_post' AND status = 'pending_review'
        ORDER BY created_at DESC
        LIMIT 30`,
    );
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
