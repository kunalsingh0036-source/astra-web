import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * /api/tasks
 *
 * GET  → list tasks. Query params:
 *        status=open|done|cancelled   default: open
 *        include_done=true            shortcut to list open+done
 *        limit=number                 default 100, max 500
 *
 * POST → create a task. Body: { title, note?, due_at?, priority?, tags? }.
 *        `due_at` accepts any ISO string; stored as TIMESTAMPTZ.
 *
 * PATCH → update a task by id. Body: { id, status? | title? | note? | … }
 *         Handy shape for the /tasks UI's one-click complete button.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUS = new Set(["open", "done", "cancelled"]);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const includeDone = url.searchParams.get("include_done") === "true";
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
  );

  let where = "WHERE status = 'open'";
  const args: (string | number)[] = [];
  if (status && ALLOWED_STATUS.has(status)) {
    args.push(status);
    where = `WHERE status = $${args.length}`;
  } else if (includeDone) {
    where = "";
  }

  const pool = astraPool();
  try {
    const rows = await pool.query(
      `SELECT id, title, note, status, priority, tags, source,
              created_at, updated_at, completed_at, due_at
       FROM tasks
       ${where}
       ORDER BY
         CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
         priority DESC,
         COALESCE(due_at, created_at) ASC
       LIMIT ${limit}`,
      args,
    );
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open,
         COUNT(*) FILTER (WHERE status = 'done')::int AS done,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE status = 'open' AND due_at < NOW())::int AS overdue
       FROM tasks`,
    );
    return Response.json({
      stats: stats.rows[0] ?? { open: 0, done: 0, cancelled: 0, overdue: 0 },
      items: rows.rows.map(toTask),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : "";
  const priority = clampPriority(body.priority);
  const tags = typeof body.tags === "string" ? body.tags : "";
  const due_at =
    typeof body.due_at === "string" && body.due_at.length > 0
      ? body.due_at
      : null;

  const pool = astraPool();
  try {
    const r = await pool.query(
      `INSERT INTO tasks (title, note, priority, tags, due_at, source, status)
       VALUES ($1, $2, $3, $4, $5::timestamptz, 'web', 'open')
       RETURNING id, title, note, status, priority, tags, source,
                 created_at, updated_at, completed_at, due_at`,
      [title, note, priority, tags, due_at],
    );
    return Response.json(toTask(r.rows[0]));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  function push(col: string, val: string | number | null) {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  }

  if (typeof body.title === "string") push("title", body.title);
  if (typeof body.note === "string") push("note", body.note);
  if (typeof body.tags === "string") push("tags", body.tags);
  if (typeof body.priority === "number") push("priority", clampPriority(body.priority));
  if (typeof body.status === "string" && ALLOWED_STATUS.has(body.status)) {
    push("status", body.status);
    if (body.status === "done") {
      sets.push("completed_at = NOW()");
    } else {
      sets.push("completed_at = NULL");
    }
  }
  if ("due_at" in body) {
    const due = body.due_at;
    if (typeof due === "string" && due.length > 0) {
      push("due_at", due);
    } else if (due === null) {
      sets.push("due_at = NULL");
    }
  }
  sets.push("updated_at = NOW()");

  if (sets.length === 1) {
    // Only updated_at — nothing to change.
    return Response.json({ error: "no updatable fields" }, { status: 400 });
  }

  args.push(id);
  const pool = astraPool();
  try {
    const r = await pool.query(
      `UPDATE tasks SET ${sets.join(", ")}
       WHERE id = $${args.length}
       RETURNING id, title, note, status, priority, tags, source,
                 created_at, updated_at, completed_at, due_at`,
      args,
    );
    if (r.rows.length === 0) {
      return Response.json({ error: "task not found" }, { status: 404 });
    }
    return Response.json(toTask(r.rows[0]));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const pool = astraPool();
  try {
    const r = await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
    if (r.rowCount === 0) {
      return Response.json({ error: "task not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

function clampPriority(v: unknown): number {
  const n = Number(v ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(3, Math.trunc(n)));
}

function toTask(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    note: String(r.note ?? ""),
    status: String(r.status ?? "open"),
    priority: Number(r.priority ?? 1),
    tags: String(r.tags ?? ""),
    source: String(r.source ?? "web"),
    created_at: dateStr(r.created_at),
    updated_at: dateStr(r.updated_at),
    completed_at: dateStr(r.completed_at),
    due_at: dateStr(r.due_at),
  };
}

function dateStr(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
