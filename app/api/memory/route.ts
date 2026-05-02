import { NextRequest, NextResponse } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/memory
 *
 * Query params:
 *   type=episodic|semantic|procedural|working   optional filter
 *   limit=number                                default 50
 *
 * Returns recent memories ordered by creation desc. No semantic
 * search yet — that requires embedding the query string which needs
 * the sentence-transformers model. Phase 4.5: add a `q=` param
 * backed by a small embedding endpoint on astra-stream.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_TYPES = new Set(["episodic", "semantic", "procedural", "working"]);

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);

  // Semantic search path — proxy to astra-stream which owns the
  // sentence-transformers model and already talks to pgvector.
  if (q) {
    return semanticSearch(q, type, limit);
  }

  try {
    const pool = astraPool();

    // Stats (counts by type) — one trip for everything.
    const [byType, rows] = await Promise.all([
      pool.query<{ memory_type: string; count: string }>(
        "SELECT memory_type::text, count(*)::text FROM memories GROUP BY memory_type ORDER BY count DESC",
      ),
      type && ALLOWED_TYPES.has(type)
        ? pool.query(
            // The Postgres enum values are uppercase (SEMANTIC,
            // EPISODIC, PROCEDURAL, WORKING) from the SQLAlchemy model.
            // We accept lowercase on the wire and upper-case it at the
            // boundary so the UI contract stays lowercase-idiomatic.
            `SELECT id, content, memory_type::text, source, tags,
                    importance, access_count, created_at
             FROM memories
             WHERE memory_type = UPPER($1)::memorytype
             ORDER BY created_at DESC
             LIMIT $2`,
            [type, limit],
          )
        : pool.query(
            `SELECT id, content, memory_type::text, source, tags,
                    importance, access_count, created_at
             FROM memories
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit],
          ),
    ]);

    return NextResponse.json({
      total: byType.rows.reduce((sum, r) => sum + Number(r.count), 0),
      // Keep the UI's contract lowercase — the chip labels match.
      by_type: Object.fromEntries(
        byType.rows.map((r) => [r.memory_type.toLowerCase(), Number(r.count)]),
      ),
      items: rows.rows.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        content: String(r.content ?? ""),
        type: String(r.memory_type ?? "").toLowerCase(),
        source: String(r.source ?? ""),
        tags: r.tags ? String(r.tags) : null,
        importance: Number(r.importance ?? 0),
        access_count: Number(r.access_count ?? 0),
        created_at: r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at ?? ""),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "db error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Proxy a semantic search to astra-stream. Adds the shared secret
 * server-side so the browser never needs to know about it.
 */
async function semanticSearch(
  q: string,
  type: string | null,
  limit: number,
): Promise<NextResponse> {
  const streamUrl = process.env.ASTRA_STREAM_URL ?? "http://localhost:8700";
  const secret = process.env.ASTRA_SHARED_SECRET ?? "";
  const params = new URLSearchParams({ q, top_k: String(limit) });
  if (type && ALLOWED_TYPES.has(type)) params.set("memory_type", type);

  const headers: Record<string, string> = {};
  if (secret) headers["x-astra-secret"] = secret;

  try {
    const r = await fetch(`${streamUrl}/memory/search?${params.toString()}`, {
      headers,
      cache: "no-store",
    });
    const body = (await r.json()) as {
      query?: string;
      count?: number;
      results?: Array<Record<string, unknown>>;
      detail?: string;
    };
    if (!r.ok) {
      return NextResponse.json(
        { error: body.detail ?? `upstream ${r.status}` },
        { status: r.status },
      );
    }
    return NextResponse.json({
      query: String(body.query ?? q),
      count: Number(body.count ?? 0),
      items: (body.results ?? []).map((row) => ({
        id: Number(row.id),
        content: String(row.content ?? ""),
        type: String(row.memory_type ?? "").toLowerCase(),
        source: String(row.source ?? ""),
        tags: row.tags != null ? String(row.tags) : null,
        similarity: Number(row.similarity ?? 0),
        importance: Number(row.importance ?? 0),
        access_count: Number(row.access_count ?? 0),
        created_at: String(row.created_at ?? ""),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "search proxy failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
