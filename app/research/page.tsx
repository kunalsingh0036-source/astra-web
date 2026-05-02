"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./research.module.css";

/**
 * /research — list of Research Intel briefings, newest-first.
 *
 * The compass + self-aware agent. 07:00 IST rotating topic Mon-Fri+Sun,
 * Saturday is the weekly meta-review.
 */

interface Row {
  id: number;
  topic: string;
  kind: string;
  status: string;
  gist: string | null;
  business_tags: string;
  model_used: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  action_item_count: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
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

function fmtDur(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ResearchPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const r = await fetch("/api/research", { cache: "no-store" });
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
    const id = setInterval(load, 30_000);
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
          <span className={styles.trailCurrent}>research</span>
        </div>
        <div className={styles.trailRight}>{rows.length} total</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>research intel</div>
        <h1 className={styles.title}>what to build, what to subtract</h1>
        <div className={styles.sub}>
          Compass-aware + self-aware. Fires 07:00 IST daily with a rotating
          topic across HelmTech / BAY / Apex / agent research, with Saturday
          as the weekly meta-review. Also on-demand via Astra chat.
        </div>
      </header>

      {loading ? <div className={styles.hint}>loading…</div> : null}
      {err ? <div className={styles.err}>{err}</div> : null}
      {!loading && rows.length === 0 ? (
        <div className={styles.empty}>
          no briefings yet. wait for 07:00 IST tomorrow or invoke on demand
          from Astra chat: &quot;research: X&quot;.
        </div>
      ) : null}

      <div className={styles.list}>
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/research/${r.id}`}
            className={styles.card}
          >
            <div className={styles.cardHead}>
              <div className={styles.cardTitle}>{r.topic}</div>
              <div className={styles.cardStatus}>
                <span
                  className={
                    styles[`state_${r.status}`] ?? styles.stateDefault
                  }
                >
                  {r.status}
                </span>
              </div>
            </div>
            <div className={styles.meta}>
              <span>{fmtDate(r.created_at)}</span>
              <span className={styles.dot}>·</span>
              <span>{r.kind}</span>
              {r.business_tags ? (
                <>
                  <span className={styles.dot}>·</span>
                  <span className={styles.tag}>{r.business_tags}</span>
                </>
              ) : null}
              {r.action_item_count > 0 ? (
                <>
                  <span className={styles.dot}>·</span>
                  <span>{r.action_item_count} actions</span>
                </>
              ) : null}
              <span className={styles.dot}>·</span>
              <span>{fmtDur(r.duration_ms)}</span>
            </div>
            {r.gist ? <div className={styles.gist}>{r.gist}</div> : null}
            {r.error ? <div className={styles.cardErr}>{r.error}</div> : null}
          </Link>
        ))}
      </div>
    </main>
  );
}
