"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./propose.module.css";

/**
 * /calendar/propose — review and approve pending calendar event proposals.
 *
 * Primary use: reviewing the 14-event weekly scaffold seed, one click
 * each (or bulk). After that, ad-hoc meetings Astra proposes also land
 * here until approved.
 */

interface Row {
  id: number;
  kind: string;
  source: string;
  summary: string;
  description: string;
  location: string;
  start_at: string | null;
  end_at: string | null;
  tz: string;
  is_all_day: boolean;
  recurrence_json: string | null;
  status: string;
  created_at: string;
  applied_at: string | null;
  error: string | null;
  resulting_google_id: string | null;
}

function fmtIST(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function fmtTimeOnlyIST(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function rruleHuman(rrule: string | null): string {
  if (!rrule) return "one-off";
  if (rrule.includes("FREQ=WEEKLY") && rrule.includes("BYDAY=MO,TU,WE,TH,FR")) {
    return "weekdays";
  }
  if (rrule.includes("FREQ=DAILY")) return "daily";
  if (rrule.includes("FREQ=WEEKLY")) return "weekly";
  return rrule.replace("RRULE:", "");
}

export default function CalendarProposePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [acting, setActing] = useState<number | "bulk" | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = useCallback(async () => {
    const r = await fetch(`/api/calendar/proposals?status=${filter}`);
    if (!r.ok) return;
    const data = (await r.json()) as { rows: Row[] };
    setRows(data.rows);
  }, [filter]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const pendingIds = useMemo(
    () => rows.filter((r) => r.status === "pending").map((r) => r.id),
    [rows],
  );

  const approve = async (id: number) => {
    setActing(id);
    try {
      await fetch(`/api/calendar/proposals/${id}/approve`, { method: "POST" });
      await load();
    } finally {
      setActing(null);
    }
  };

  const reject = async (id: number) => {
    setActing(id);
    try {
      await fetch(`/api/calendar/proposals/${id}/reject`, { method: "POST" });
      await load();
    } finally {
      setActing(null);
    }
  };

  const bulkApprove = async () => {
    if (pendingIds.length === 0) return;
    setActing("bulk");
    try {
      await fetch(`/api/calendar/proposals/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", ids: pendingIds }),
      });
      await load();
    } finally {
      setActing(null);
    }
  };

  const bulkReject = async () => {
    if (pendingIds.length === 0) return;
    setActing("bulk");
    try {
      await fetch(`/api/calendar/proposals/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", ids: pendingIds }),
      });
      await load();
    } finally {
      setActing(null);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>calendar / propose</span>
        </div>
        <div className={styles.trailRight}>
          {rows.filter((r) => r.status === "pending").length} pending
        </div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>calendar</div>
        <h1 className={styles.title}>proposals</h1>
        <div className={styles.sub}>
          Astra stages every calendar write here. Approve to create in Google.
          Scheduler applies within 60 s.
        </div>
      </header>

      <div className={styles.controls}>
        <div className={styles.filters}>
          <button
            className={filter === "pending" ? styles.filterActive : styles.filter}
            onClick={() => setFilter("pending")}
          >
            pending
          </button>
          <button
            className={filter === "all" ? styles.filterActive : styles.filter}
            onClick={() => setFilter("all")}
          >
            all
          </button>
        </div>
        {pendingIds.length > 0 ? (
          <div className={styles.bulk}>
            <button
              onClick={bulkApprove}
              disabled={acting !== null}
              className={styles.bulkApprove}
            >
              {acting === "bulk" ? "…" : `approve all ${pendingIds.length}`}
            </button>
            <button
              onClick={bulkReject}
              disabled={acting !== null}
              className={styles.bulkReject}
            >
              reject all
            </button>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          no proposals. run the scaffold seed from astra to populate.
        </div>
      ) : null}

      <div className={styles.list}>
        {rows.map((row) => (
          <article key={row.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitle}>
                <span className={styles.kind}>{row.kind}</span>
                <span className={styles.summary}>{row.summary}</span>
              </div>
              <div className={styles.cardStatus}>
                <span className={styles[`status_${row.status}`] ?? styles.statusDefault}>
                  {row.status}
                </span>
              </div>
            </div>

            <div className={styles.meta}>
              <div className={styles.metaTime}>
                {row.is_all_day ? (
                  <span>all-day</span>
                ) : (
                  <span>
                    {fmtTimeOnlyIST(row.start_at)}–{fmtTimeOnlyIST(row.end_at)} IST
                  </span>
                )}
                <span className={styles.dot}>·</span>
                <span className={styles.rrule}>{rruleHuman(row.recurrence_json)}</span>
                {row.location ? (
                  <>
                    <span className={styles.dot}>·</span>
                    <span className={styles.location}>{row.location}</span>
                  </>
                ) : null}
              </div>
              {row.source !== "manual" ? (
                <div className={styles.source}>source · {row.source}</div>
              ) : null}
            </div>

            {row.description ? (
              <div className={styles.desc}>{row.description}</div>
            ) : null}

            {row.error ? <div className={styles.err}>{row.error}</div> : null}

            {row.status === "pending" ? (
              <div className={styles.actions}>
                <button
                  onClick={() => approve(row.id)}
                  disabled={acting !== null}
                  className={styles.apply}
                >
                  {acting === row.id ? "…" : "apply"}
                </button>
                <button
                  onClick={() => reject(row.id)}
                  disabled={acting !== null}
                  className={styles.reject}
                >
                  reject
                </button>
              </div>
            ) : row.status === "approved" ? (
              <div className={styles.hint}>approved · worker writes in &lt; 60 s</div>
            ) : row.status === "applied" ? (
              <div className={styles.hint}>
                applied · google id {row.resulting_google_id?.slice(0, 14)}…
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
