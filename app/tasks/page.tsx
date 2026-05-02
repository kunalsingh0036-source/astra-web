"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tasks.module.css";

/**
 * /tasks — the flat to-do list.
 *
 * Astra manages these via the astra-tasks MCP tools (add_task,
 * list_tasks, complete_task). The page here is direct-manipulation:
 * type to add, check to complete, click to edit.
 */

interface Task {
  id: number;
  title: string;
  note: string;
  status: "open" | "done" | "cancelled" | string;
  priority: number;
  tags: string;
  source: string;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  due_at: string | null;
}

interface Stats {
  open: number;
  done: number;
  cancelled: number;
  overdue: number;
}

interface TasksResponse {
  stats: Stats;
  items: Task[];
}

type Filter = "open" | "all" | "done";

export default function TasksPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const [data, setData] = useState<TasksResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter === "all") params.set("include_done", "true");
      if (filter === "done") params.set("status", "done");
      const r = await fetch(`/api/tasks?${params.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as TasksResponse;
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function addTask(title: string) {
    const t = title.trim();
    if (!t) return;
    setDraft("");
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      load();
    } catch {
      /* silent */
    }
  }

  async function complete(task: Task) {
    const nextStatus = task.status === "done" ? "open" : "done";
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: task.id, status: nextStatus }),
      });
      load();
    } catch {
      /* silent */
    }
  }

  async function remove(task: Task) {
    try {
      await fetch(`/api/tasks?id=${task.id}`, { method: "DELETE" });
      load();
    } catch {
      /* silent */
    }
  }

  async function setPriority(task: Task, p: number) {
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: task.id, priority: p }),
      });
      load();
    } catch {
      /* silent */
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const stats = data?.stats;

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>tasks</span>
        </div>
        <div className={styles.trailRight}>
          {stats && (
            <span>
              {stats.open} open · {stats.done} done
              {stats.overdue > 0 && (
                <span className={styles.overdueTag}> · {stats.overdue} overdue</span>
              )}
            </span>
          )}
          {loading && <span>loading…</span>}
          {error && <span className={styles.errText}>error · {error}</span>}
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>tasks · persistent to-do</div>
        <h1 className={styles.title}>what I&apos;m tracking.</h1>
        <p className={styles.summary}>
          The things worth not forgetting. Ask Astra to add them, or type below
          — both land in the same list.
        </p>
      </section>

      <section className={styles.addBar}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addTask(draft);
          }}
          className={styles.addForm}
        >
          <span className={styles.addPrompt}>+</span>
          <input
            className={styles.addInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="add a task…"
            aria-label="Add task"
          />
        </form>
      </section>

      <section className={styles.filterRow} role="tablist">
        {(["open", "all", "done"] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`${styles.filter} ${filter === f ? styles.active : ""}`}
            onClick={() => setFilter(f)}
            type="button"
          >
            {f}
          </button>
        ))}
      </section>

      <section className={styles.list}>
        {items.length === 0 && !loading && (
          <p className={styles.empty}>
            {filter === "open"
              ? "Nothing open. The mind is quiet."
              : "No tasks match."}
          </p>
        )}
        {items.map((t) => (
          <article
            key={t.id}
            className={`${styles.item} ${t.status === "done" ? styles.itemDone : ""}`}
          >
            <button
              type="button"
              className={styles.check}
              aria-label={t.status === "done" ? "Mark open" : "Mark done"}
              aria-pressed={t.status === "done"}
              onClick={() => complete(t)}
            >
              <span className={styles.checkDot} />
            </button>

            <div className={styles.itemBody}>
              <div className={styles.itemTitle}>{t.title}</div>
              {t.note && <div className={styles.itemNote}>{t.note}</div>}
              <div className={styles.itemMeta}>
                <span className={styles.priority}>
                  {["none", "normal", "high", "urgent"][t.priority] ?? "normal"}
                </span>
                {t.tags && <span className={styles.tags}>· {t.tags}</span>}
                {t.due_at && (
                  <span className={styles.due}>· due {formatDate(t.due_at)}</span>
                )}
                <span className={styles.source}>· from {t.source}</span>
                <span className={styles.created}>
                  · {timeAgo(t.created_at)}
                </span>
              </div>
            </div>

            <div className={styles.itemActions}>
              <select
                className={styles.priSelect}
                value={t.priority}
                onChange={(e) => setPriority(t, Number(e.target.value))}
                aria-label="Priority"
              >
                <option value={0}>— none</option>
                <option value={1}>· normal</option>
                <option value={2}>! high</option>
                <option value={3}>!! urgent</option>
              </select>
              <button
                type="button"
                className={styles.delete}
                aria-label="Delete task"
                onClick={() => remove(t)}
              >
                ×
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "2-digit" })
    .toLowerCase();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const dy = Math.round(h / 24);
  return dy === 1 ? "yesterday" : `${dy}d ago`;
}
