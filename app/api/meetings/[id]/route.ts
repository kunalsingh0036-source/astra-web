import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/meetings/[id]
 *
 * Full meeting row + its staged tasks.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MeetingRow = {
  id: number;
  title: string;
  recorded_at: string | null;
  duration_seconds: number | null;
  state: string;
  model_used: string;
  transcript: string;
  summary: string;
  action_items: unknown[];
  task_ids: number[];
  error: string | null;
  created_at: string;
};

type TaskRow = {
  id: number;
  title: string;
  note: string;
  priority: number;
  status: string;
  due_at: string | null;
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
    const { rows } = await pool.query<MeetingRow>(
      `SELECT id, title, recorded_at, duration_seconds, state, model_used,
              transcript, summary, action_items, task_ids, error, created_at
       FROM meetings
       WHERE id = $1`,
      [numId],
    );
    if (rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const meeting = rows[0];

    let tasks: TaskRow[] = [];
    const taskIds = Array.isArray(meeting.task_ids) ? meeting.task_ids : [];
    if (taskIds.length > 0) {
      const taskRes = await pool.query<TaskRow>(
        `SELECT id, title, note, priority, status, due_at
         FROM tasks
         WHERE id = ANY($1::int[])
         ORDER BY priority DESC, id ASC`,
        [taskIds],
      );
      tasks = taskRes.rows;
    }

    return Response.json({ meeting, tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
