"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./meetings.module.css";

/**
 * /meetings — list of recorded meetings, newest first.
 *
 * Each row links to /meetings/[id] for the full transcript + summary +
 * action items + follow-up draft.
 */

interface Row {
  id: number;
  title: string;
  recorded_at: string | null;
  duration_seconds: number | null;
  state: string;
  model_used: string;
  gist: string | null;
  task_count: number;
  created_at: string;
  error: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function fmtDur(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s <= 0) return "—";
  const m = Math.round(s / 60);
  if (m < 1) return `${Math.round(s)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function MeetingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const r = await fetch("/api/meetings", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { rows: Row[] };
        if (!aborted) setRows(data.rows);
      } catch (e) {
        if (!aborted) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, []);

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>meetings</span>
        </div>
        <div className={styles.trailRight}>{rows.length} total</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>meetings</div>
        <h1 className={styles.title}>what got said</h1>
        <div className={styles.sub}>
          Transcribed locally by whisper.cpp on Metal. Summarized + action-item-extracted by Claude. Nothing leaves the box for transcription.
        </div>
      </header>

      {loading ? <div className={styles.hint}>loading…</div> : null}
      {err ? <div className={styles.err}>{err}</div> : null}

      {!loading && rows.length === 0 ? (
        <div className={styles.empty}>
          no meetings yet. drop an audio file into ~/Astra/recordings/ or wait for a calendar-triggered capture.
        </div>
      ) : null}

      <div className={styles.list}>
        {rows.map((r) => (
          <Link key={r.id} href={`/meetings/${r.id}`} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitle}>{r.title || `#${r.id}`}</div>
              <div className={styles.cardStatus}>
                <span
                  className={
                    styles[`state_${r.state}`] ?? styles.stateDefault
                  }
                >
                  {r.state}
                </span>
              </div>
            </div>
            <div className={styles.meta}>
              <span>{fmtDate(r.recorded_at)}</span>
              <span className={styles.dot}>·</span>
              <span>{fmtDur(r.duration_seconds)}</span>
              {r.task_count > 0 ? (
                <>
                  <span className={styles.dot}>·</span>
                  <span>
                    {r.task_count} action item{r.task_count === 1 ? "" : "s"}
                  </span>
                </>
              ) : null}
            </div>
            {r.gist ? <div className={styles.gist}>{r.gist}</div> : null}
            {r.error ? <div className={styles.cardErr}>{r.error}</div> : null}
          </Link>
        ))}
      </div>
    </main>
  );
}
