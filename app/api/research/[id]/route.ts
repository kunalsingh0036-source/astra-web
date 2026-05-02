import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Briefing = {
  id: number;
  topic: string;
  kind: string;
  status: string;
  body_md: string;
  signals: unknown[];
  action_items: unknown[];
  sources: unknown[];
  business_tags: string;
  memory_id: number | null;
  task_ids: number[];
  model_used: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

type Task = {
  id: number;
  title: string;
  priority: number;
  status: string;
  due_at: string | null;
  note: string;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const pool = astraPool();
  try {
    const { rows } = await pool.query<Briefing>(
      `SELECT id, topic, kind, status, body_md, signals, action_items,
              sources, business_tags, memory_id, task_ids, model_used,
              duration_ms, created_at, completed_at, error
       FROM research_briefings
       WHERE id = $1`,
      [numId],
    );
    if (rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const briefing = rows[0];

    let tasks: Task[] = [];
    const taskIds = Array.isArray(briefing.task_ids) ? briefing.task_ids : [];
    if (taskIds.length > 0) {
      const tr = await pool.query<Task>(
        `SELECT id, title, priority, status, due_at, note
         FROM tasks WHERE id = ANY($1::int[])
         ORDER BY priority DESC, id ASC`,
        [taskIds],
      );
      tasks = tr.rows;
    }
    return Response.json({ briefing, tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
