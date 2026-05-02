"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./tonight.module.css";

/**
 * /tonight — the 21:30 catch-up form.
 *
 * Six-row hour input. On submit we POST to /api/catchup, which stages
 * a pending approval and returns the computed deltas. Kunal then hits
 * Apply to flip it to 'approved'; the scheduler writes within 60s.
 *
 * Also shows the current pending approval (if one already exists for
 * today) so refreshing doesn't lose state.
 */

type CounterKey =
  | "stretch"
  | "meditate"
  | "breathe"
  | "movement"
  | "skill"
  | "workout";

const COUNTERS: { key: CounterKey; label: string }[] = [
  { key: "stretch", label: "Stretch" },
  { key: "meditate", label: "Meditate" },
  { key: "breathe", label: "Breathe" },
  { key: "movement", label: "Movement" },
  { key: "skill", label: "Skill" },
  { key: "workout", label: "Workout" },
];

interface ApprovalRow {
  id: number;
  reply_id: string;
  decrements: Partial<Record<CounterKey, number>>;
  before_counters: Partial<Record<CounterKey, number | null>>;
  projected_after: Partial<Record<CounterKey, number | null>>;
  hours_reported: Partial<Record<CounterKey, number>> | null;
  status: string;
  created_at: string;
  approved_at: string | null;
  applied_at: string | null;
  error: string | null;
}

export default function TonightPage() {
  const [hours, setHours] = useState<Record<CounterKey, string>>(() =>
    Object.fromEntries(COUNTERS.map((c) => [c.key, ""])) as Record<
      CounterKey,
      string
    >,
  );
  const [pending, setPending] = useState<ApprovalRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPending = async () => {
    try {
      const r = await fetch("/api/catchup?status=pending");
      if (!r.ok) return;
      const data = (await r.json()) as { rows: ApprovalRow[] };
      setPending(data.rows[0] ?? null);
    } catch {
      // ignore — UI still usable without pending list
    }
  };

  useEffect(() => {
    loadPending();
    // Gentle poll so Apply → applied status updates in-place without
    // a manual reload.
    const id = setInterval(loadPending, 15_000);
    return () => clearInterval(id);
  }, []);

  const totalHours = useMemo(
    () =>
      Object.values(hours).reduce((s, v) => {
        const n = Number(v);
        return Number.isFinite(n) ? s + n : s;
      }, 0),
    [hours],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const payload: Record<string, number> = {};
      for (const c of COUNTERS) {
        const v = Number(hours[c.key]);
        payload[c.key] = Number.isFinite(v) && v > 0 ? v : 0;
      }
      const r = await fetch("/api/catchup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) {
        setErr(body.error ?? `error ${r.status}`);
      } else {
        // Reload pending to show the freshly-staged row.
        await loadPending();
        // Clear form so re-submission for a different set is obvious.
        setHours(
          Object.fromEntries(COUNTERS.map((c) => [c.key, ""])) as Record<
            CounterKey,
            string
          >,
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async () => {
    if (!pending) return;
    setActing(true);
    try {
      await fetch(`/api/catchup/${pending.id}/approve`, { method: "POST" });
      await loadPending();
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    if (!pending) return;
    setActing(true);
    try {
      await fetch(`/api/catchup/${pending.id}/reject`, { method: "POST" });
      await loadPending();
    } finally {
      setActing(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>tonight</span>
        </div>
        <div className={styles.trailRight}>21:30 catch-up</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>catch-up</div>
        <h1 className={styles.title}>what got done today</h1>
        <div className={styles.sub}>
          Hours per counter. Zeros are fine. Submits to a pending
          approval — nothing writes to your Kunal note until you Apply.
        </div>
      </header>

      <form onSubmit={onSubmit} className={styles.form}>
        {COUNTERS.map((c) => (
          <label key={c.key} className={styles.row}>
            <span className={styles.rowLabel}>{c.label}</span>
            <input
              type="number"
              step="0.25"
              min="0"
              max="24"
              inputMode="decimal"
              value={hours[c.key]}
              onChange={(e) =>
                setHours((h) => ({ ...h, [c.key]: e.target.value }))
              }
              placeholder="0"
              className={styles.rowInput}
            />
            <span className={styles.rowUnit}>hr</span>
          </label>
        ))}

        <div className={styles.formFoot}>
          <span className={styles.total}>
            total · {totalHours ? totalHours.toFixed(2) : "0"} hr
          </span>
          <button
            type="submit"
            disabled={submitting || totalHours <= 0}
            className={styles.submit}
          >
            {submitting ? "…" : "submit"}
          </button>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}
      </form>

      {pending ? (
        <section className={styles.pending}>
          <div className={styles.pendingHead}>
            <span className={styles.kicker}>
              pending · {pending.status}
            </span>
            <span className={styles.ts}>
              {new Date(pending.created_at).toLocaleTimeString()}
            </span>
          </div>

          <div className={styles.table}>
            {COUNTERS.map((c) => {
              const before = pending.before_counters[c.key] ?? null;
              const after = pending.projected_after[c.key] ?? null;
              const dec = pending.decrements[c.key] ?? 0;
              const changed = dec > 0;
              return (
                <div
                  key={c.key}
                  className={changed ? styles.tblRowActive : styles.tblRow}
                >
                  <span className={styles.tblLabel}>{c.label}</span>
                  <span className={styles.tblBefore}>
                    {before ?? "—"}
                  </span>
                  <span className={styles.tblArrow}>
                    {changed ? "→" : " "}
                  </span>
                  <span className={styles.tblAfter}>
                    {changed ? after : ""}
                  </span>
                  <span className={styles.tblDelta}>
                    {changed ? `−${dec}` : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {pending.status === "pending" ? (
            <div className={styles.actions}>
              <button
                onClick={approve}
                disabled={acting}
                className={styles.apply}
              >
                {acting ? "…" : "apply"}
              </button>
              <button
                onClick={reject}
                disabled={acting}
                className={styles.reject}
              >
                reject
              </button>
            </div>
          ) : null}

          {pending.status === "approved" ? (
            <div className={styles.hint}>
              approved · apply-worker writes within 60s
            </div>
          ) : null}
          {pending.status === "applied" ? (
            <div className={styles.hint}>
              applied · note updated at{" "}
              {pending.applied_at
                ? new Date(pending.applied_at).toLocaleTimeString()
                : "—"}
            </div>
          ) : null}
          {pending.status === "error" ? (
            <div className={styles.err}>{pending.error ?? "write error"}</div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
