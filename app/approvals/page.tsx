"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./approvals.module.css";

/**
 * /approvals — the trust-staging surface.
 *
 * Every row is a tool call the autonomy gate paused for Kunal's
 * yes/no. Approve = one-shot grant (the next identical tool call
 * consumes it; re-ask Astra to run the action). "Always allow"
 * additionally writes a standing tool_grant — that tool stops
 * asking entirely (revocable via the revoke_tool_grant chat tool).
 * Pending rows older than 24h are expired by the retention sweep:
 * a stale yes is not a yes.
 */

interface Approval {
  id: number;
  turn_id: number | null;
  tool_name: string;
  tool_input: Record<string, unknown>;
  reason: string;
  created_at: string;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/approvals", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { approvals: Approval[] };
      setItems(body.approvals);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function resolve(
    id: number,
    decision: "approved" | "denied",
    standing = false,
  ) {
    setBusy(id);
    try {
      const r = await fetch(`/api/approvals/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, standing }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "resolve failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1>approvals</h1>
        <p className={styles.sub}>
          actions waiting on you. approve = run once on the next ask ·
          always = stop asking for that tool · expired after 24h.
        </p>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {items === null ? (
        <p className={styles.empty}>loading…</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>
          nothing pending — astra isn&apos;t waiting on you.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((a) => (
            <li key={a.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.tool}>{a.tool_name}</span>
                <span className={styles.id}>#{a.id}</span>
                <span className={styles.when}>
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              <pre className={styles.input}>
                {JSON.stringify(a.tool_input, null, 2).slice(0, 600)}
              </pre>
              <p className={styles.reason}>{a.reason}</p>
              <div className={styles.actions}>
                <button
                  className={styles.approve}
                  disabled={busy === a.id}
                  onClick={() => void resolve(a.id, "approved")}
                >
                  approve once
                </button>
                <button
                  className={styles.always}
                  disabled={busy === a.id}
                  onClick={() => void resolve(a.id, "approved", true)}
                >
                  always allow {a.tool_name}
                </button>
                <button
                  className={styles.deny}
                  disabled={busy === a.id}
                  onClick={() => void resolve(a.id, "denied")}
                >
                  deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
