"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./research-detail.module.css";

interface Briefing {
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
}

interface Task {
  id: number;
  title: string;
  priority: number;
  status: string;
  due_at: string | null;
  note: string;
}

function renderMarkdown(md: string): React.ReactNode {
  // Light-touch renderer — headings, bold, bullets, italics.
  const lines = md.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let key = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      out.push(<div key={key++} className={styles.spacer} />);
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(
        <h1 key={key++} className={styles.h1}>
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("## ")) {
      out.push(
        <h2 key={key++} className={styles.h2}>
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("- ")) {
      out.push(
        <div key={key++} className={styles.bullet}>
          {inline(line.slice(2))}
        </div>,
      );
    } else if (line.startsWith("  _") && line.endsWith("_")) {
      out.push(
        <div key={key++} className={styles.italic}>
          {line.trim().slice(1, -1)}
        </div>,
      );
    } else if (line.startsWith("  ")) {
      out.push(
        <div key={key++} className={styles.indent}>
          {inline(line.trim())}
        </div>,
      );
    } else {
      out.push(
        <div key={key++} className={styles.para}>
          {inline(line)}
        </div>,
      );
    }
  }
  return out;
}

function inline(s: string): React.ReactNode {
  // **bold** and _italic_ — good enough for our own output.
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < s.length) {
    if (s[i] === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i) {
        parts.push(
          <strong key={key++}>{s.substring(i + 2, end)}</strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if (s[i] === "_") {
      const end = s.indexOf("_", i + 1);
      if (end > i) {
        parts.push(<em key={key++}>{s.substring(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    const nextMarker = findNext(s, i, ["**", "_"]);
    if (nextMarker === -1) {
      parts.push(<span key={key++}>{s.substring(i)}</span>);
      break;
    } else {
      parts.push(<span key={key++}>{s.substring(i, nextMarker)}</span>);
      i = nextMarker;
    }
  }
  return parts;
}

function findNext(s: string, from: number, markers: string[]): number {
  let best = -1;
  for (const m of markers) {
    const idx = s.indexOf(m, from);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

export default function ResearchDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<{ briefing: Briefing; tasks: Task[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/research/${id}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!aborted) setData(body);
      } catch (e) {
        if (!aborted) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => {
      aborted = true;
      clearInterval(iv);
    };
  }, [id]);

  if (err)
    return (
      <main className={styles.main}>
        <div className={styles.err}>{err}</div>
      </main>
    );
  if (!data)
    return (
      <main className={styles.main}>
        <div className={styles.hint}>loading…</div>
      </main>
    );

  const { briefing, tasks } = data;

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <Link href="/research">research</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>#{briefing.id}</span>
        </div>
        <div className={styles.trailRight}>{briefing.status}</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>
          research intel · {briefing.kind}
        </div>
        <h1 className={styles.title}>{briefing.topic}</h1>
        <div className={styles.metaRow}>
          <span>{new Date(briefing.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
          <span className={styles.dot}>·</span>
          <span>{briefing.model_used || "—"}</span>
          {briefing.duration_ms ? (
            <>
              <span className={styles.dot}>·</span>
              <span>{(briefing.duration_ms / 1000).toFixed(1)}s</span>
            </>
          ) : null}
          {briefing.business_tags ? (
            <>
              <span className={styles.dot}>·</span>
              <span className={styles.tag}>{briefing.business_tags}</span>
            </>
          ) : null}
        </div>
      </header>

      {briefing.error ? <div className={styles.err}>{briefing.error}</div> : null}

      {briefing.body_md ? (
        <article className={styles.body}>
          {renderMarkdown(briefing.body_md)}
        </article>
      ) : null}

      {tasks.length > 0 ? (
        <section className={styles.tasksBlock}>
          <div className={styles.sectionLabel}>staged tasks</div>
          <div className={styles.tasks}>
            {tasks.map((t) => (
              <div key={t.id} className={styles.task}>
                <span className={styles.taskPrio}>p{t.priority}</span>
                <span className={styles.taskTitle}>{t.title}</span>
                <span className={styles.taskStatus}>{t.status}</span>
                {t.due_at ? (
                  <span className={styles.taskDue}>
                    due {new Date(t.due_at).toLocaleDateString("en-IN")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
