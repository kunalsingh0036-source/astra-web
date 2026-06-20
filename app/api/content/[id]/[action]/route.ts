import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * POST /api/content/{id}/{action}
 *
 * Act on a staged LinkedIn post draft. Direct DB write via the astra
 * pool (no HTTP hop — the drafter/LLM lives server-side; the web only
 * does the non-LLM lifecycle ops here, AI-refine is chat-only).
 *
 *   approve  body: { text? }              → save edit, status='approved' (=shipped)
 *   posted   body: { text?, posted_url? } → status='posted' (+ URL)
 *   discard  (no body)                    → status='rejected'
 *
 * Astra never posts to LinkedIn; 'approve' is Kunal's signal he's
 * shipping it himself.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(["approve", "posted", "discard"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ALLOWED.has(action)) {
    return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  let payload: { text?: string; posted_url?: string } = {};
  if (action !== "discard") {
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
  }

  const pool = astraPool();
  try {
    if (action === "discard") {
      const r = await pool.query(
        `UPDATE creator_artifacts SET status='rejected', updated_at=now()
          WHERE id=$1 AND kind='linkedin_post'`,
        [idNum],
      );
      if (!r.rowCount) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ ok: true, status: "rejected" });
    }

    const status = action === "posted" ? "posted" : "approved";
    const merge: Record<string, string> = {};
    if (typeof payload.text === "string" && payload.text.trim()) {
      merge.edited_text = payload.text;
    }
    if (action === "posted" && payload.posted_url) {
      merge.posted_url = payload.posted_url;
    }
    const r = await pool.query(
      `UPDATE creator_artifacts
          SET content = COALESCE(content,'{}'::jsonb) || $1::jsonb,
              status = $2,
              updated_at = now()
        WHERE id = $3 AND kind = 'linkedin_post'`,
      [JSON.stringify(merge), status, idNum],
    );
    if (!r.rowCount) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ok: true, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
