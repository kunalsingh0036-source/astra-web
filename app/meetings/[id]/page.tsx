"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./meeting-detail.module.css";

interface ActionItem {
  title?: string;
  owner?: string;
  due?: string | null;
  priority?: number;
}

interface Meeting {
  id: number;
  title: string;
  recorded_at: string | null;
  duration_seconds: number | null;
  state: string;
  model_used: string;
  transcript: string;
  summary: string;
  action_items: ActionItem[];
  task_ids: number[];
  error: string | null;
  created_at: string;
}

interface Task {
  id: number;
  title: string;
  note: string;
  priority: number;
  status: string;
  due_at: string | null;
}

function renderSummary(md: string): React.ReactNode {
  // Minimal markdown rendering: split on **Header.** patterns.
  // Good enough for our own-authored summaries; no need for a full MD lib.
  const lines = md.split(/\n/);
  const blocks: React.ReactNode[] = [];
  let key = 0;
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (t.startsWith("**") && t.includes(".**")) {
      const split = t.split(".**");
      const header = split[0].replace(/^\*\*/, "");
      const rest = split.slice(1).join(".**").trim();
      blocks.push(
        <div key={key++} className={styles.section}>
          <div className={styles.sectionLabel}>{header}</div>
          {rest ? <div className={styles.sectionBody}>{rest}</div> : null}
        </div>,
      );
    } else if (t.startsWith("- ")) {
      blocks.push(
        <div key={key++} className={styles.bullet}>
          • {t.slice(2)}
        </div>,
      );
    } else {
      blocks.push(
        <div key={key++} className={styles.para}>
          {t}
        </div>,
      );
    }
  }
  return blocks;
}

export default function MeetingDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<{ meeting: Meeting; tasks: Task[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/meetings/${id}`, { cache: "no-store" });
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

  const { meeting, tasks } = data;

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <Link href="/meetings">meetings</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>#{meeting.id}</span>
        </div>
        <div className={styles.trailRight}>{meeting.state}</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>meeting</div>
        <h1 className={styles.title}>{meeting.title || `#${meeting.id}`}</h1>
        <div className={styles.metaRow}>
          {meeting.recorded_at ? (
            <span>
              {new Date(meeting.recorded_at).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}
            </span>
          ) : null}
          {meeting.duration_seconds ? (
            <>
              <span className={styles.dot}>·</span>
              <span>{Math.round(meeting.duration_seconds / 60)}m</span>
            </>
          ) : null}
          <span className={styles.dot}>·</span>
          <span>{meeting.model_used}</span>
        </div>
      </header>

      {meeting.error ? (
        <div className={styles.err}>{meeting.error}</div>
      ) : null}

      {meeting.summary ? (
        <section className={styles.summary}>
          {renderSummary(meeting.summary)}
        </section>
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

      {meeting.transcript ? (
        <section className={styles.transcriptBlock}>
          <button
            className={styles.transcriptToggle}
            onClick={() => setShowTranscript((s) => !s)}
          >
            {showTranscript ? "hide transcript" : "show transcript"}
          </button>
          {showTranscript ? (
            <pre className={styles.transcript}>{meeting.transcript}</pre>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
