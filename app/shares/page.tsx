"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./shares.module.css";

/**
 * /shares — every payload the iOS extension has sent.
 *
 * Read-only. State shows the classification outcome (memory / task /
 * meeting / note). Click through to the underlying task or memory.
 */

interface ShareRow {
  id: number;
  kind: string;
  source_app: string;
  source_url: string;
  title: string;
  text: string;
  note: string;
  file_path: string;
  mime_type: string;
  state: string;
  summary: string;
  action_taken: string;
  memory_id: number | null;
  task_ids: number[];
  error: string | null;
  created_at: string;
  processed_at: string | null;
  // ── shipped 2026-04-25: pipeline now extracts content + supports
  //    retries; iOS extension can stamp client_ts at capture time.
  extracted_text?: string;
  retry_count?: number;
  client_ts?: string | null;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
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

export default function SharesPage() {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const r = await fetch("/api/shares", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!aborted) setRows(body.rows ?? []);
      } catch (e) {
        if (!aborted) setErr(e instanceof Error ? e.message : String(e));
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
          <span className={styles.trailCurrent}>shares</span>
        </div>
        <div className={styles.trailRight}>{rows.length} total</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>share · inbox</div>
        <h1 className={styles.title}>from the phone</h1>
        <div className={styles.sub}>
          Everything you sent to Astra via the iOS Share Sheet. Classified by
          Haiku, filed as task / memory / meeting automatically.
        </div>
      </header>

      {err ? <div className={styles.err}>{err}</div> : null}
      {rows.length === 0 ? (
        <div className={styles.empty}>
          nothing shared yet. pair your phone at <Link href="/settings/share">settings / share</Link>.
        </div>
      ) : null}

      <div className={styles.list}>
        {rows.map((r) => (
          <article
            key={r.id}
            className={
              r.state === "error"
                ? styles.cardErr
                : r.state === "received"
                  ? styles.cardPending
                  : styles.card
            }
          >
            <div className={styles.cardHead}>
              <span className={styles.cardTime}>{fmtTime(r.created_at)}</span>
              <span className={styles.sourceApp}>{r.source_app || r.kind}</span>
              {r.action_taken ? (
                <span
                  className={
                    styles[`action_${r.action_taken}`] ?? styles.actionDefault
                  }
                >
                  {r.action_taken}
                </span>
              ) : (
                <span className={styles.stPending}>{r.state}</span>
              )}
            </div>

            {r.title ? <div className={styles.title2}>{r.title}</div> : null}

            {r.summary ? (
              <div className={styles.aiSummary}>— {r.summary}</div>
            ) : r.text ? (
              <div className={styles.snippet}>{r.text.slice(0, 280)}</div>
            ) : r.source_url ? (
              <div className={styles.snippet}>
                <a href={r.source_url} target="_blank" rel="noreferrer">
                  {r.source_url}
                </a>
              </div>
            ) : null}

            {r.note ? <div className={styles.note}>note: {r.note}</div> : null}

            {r.task_ids.length > 0 ? (
              <div className={styles.links}>
                {r.task_ids.map((tid) => (
                  <Link key={tid} href="/tasks" className={styles.linkChip}>
                    task #{tid}
                  </Link>
                ))}
              </div>
            ) : null}

            {r.error ? <div className={styles.err}>{r.error}</div> : null}
          </article>
        ))}
      </div>
    </main>
  );
}
