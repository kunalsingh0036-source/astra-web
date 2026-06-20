"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./replies.module.css";

/**
 * /replies — the inbox beachhead's human-in-the-loop surface.
 *
 * Astra silently drafts replies to action-needed mail (the inbox_triage
 * job). This page is where Kunal clears them: read, edit in place,
 * Send (real email, in-thread) / Refine (revise, keeps his voice) /
 * Discard. Every send is an explicit click on a specific draft — the
 * loop is human-approved end to end. The metric strip up top is the
 * Friday number: draft-sent rate + time saved.
 */

interface Draft {
  id: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  body_text: string;
  status: string;
  created_at: string;
}

interface Metrics {
  window_days: number;
  generated: number;
  sent: number;
  sent_as_is: number;
  sent_edited: number;
  discarded: number;
  pending: number;
  draft_sent_rate: number | null;
  est_minutes_saved: number;
}

function fmtRecipient(addrs: string[]): string {
  if (!addrs?.length) return "(no recipient)";
  const m = addrs[0].match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1].trim() : addrs[0]).slice(0, 60);
}

function fmtSavedTime(mins: number): string {
  if (!mins) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function RepliesPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [refineOpen, setRefineOpen] = useState<Record<string, boolean>>({});
  const [refineText, setRefineText] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await fetch("/api/replies/metrics?days=7", {
        cache: "no-store",
      }).then((r) => r.json());
      if (!m.error) setMetrics(m);
    } catch {
      /* metrics are non-critical */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/replies?limit=30", {
        cache: "no-store",
      }).then((r) => r.json());
      if (d.error) {
        setErr(d.error);
        setDrafts([]);
      } else {
        setDrafts(d);
        setEdited((prev) => {
          const next = { ...prev };
          for (const row of d as Draft[]) {
            if (next[row.id] === undefined) next[row.id] = row.body_text;
          }
          return next;
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadMetrics();
  }, [load, loadMetrics]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  const drop = (id: string) =>
    setDrafts((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));

  const doSend = async (d: Draft) => {
    setBusy((b) => ({ ...b, [d.id]: "send" }));
    setErr(null);
    try {
      const body = (edited[d.id] ?? d.body_text).trim();
      const r = await fetch(`/api/replies/${d.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body_override: body }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
      drop(d.id);
      flash(`Sent to ${fmtRecipient(d.to_addresses)}${data.was_edited ? " (your edit)" : ""}.`);
      loadMetrics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: "" }));
    }
  };

  const doDiscard = async (d: Draft) => {
    setBusy((b) => ({ ...b, [d.id]: "discard" }));
    try {
      const r = await fetch(`/api/replies/${d.id}/discard`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      drop(d.id);
      flash("Discarded.");
      loadMetrics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: "" }));
    }
  };

  const doRefine = async (d: Draft) => {
    const instruction = (refineText[d.id] ?? "").trim();
    if (!instruction) return;
    setBusy((b) => ({ ...b, [d.id]: "refine" }));
    setErr(null);
    try {
      const r = await fetch(`/api/replies/${d.id}/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
      // Replace the draft's body in place with the revised version.
      setDrafts((prev) =>
        prev
          ? prev.map((x) =>
              x.id === d.id
                ? { ...x, body_text: data.body_text, subject: data.subject }
                : x,
            )
          : prev,
      );
      setEdited((e) => ({ ...e, [d.id]: data.body_text }));
      setRefineOpen((o) => ({ ...o, [d.id]: false }));
      setRefineText((t) => ({ ...t, [d.id]: "" }));
      flash("Revised — review and send.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: "" }));
    }
  };

  const rate =
    metrics?.draft_sent_rate != null
      ? `${Math.round(metrics.draft_sent_rate * 100)}%`
      : "—";

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>replies</span>
        </div>
        <Link href="/email" className={styles.trailRight}>
          inbox lens →
        </Link>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>INBOX · DRAFTED FOR YOU</div>
        <h1 className={styles.title}>Replies waiting</h1>
        <p className={styles.sub}>
          Astra drafted these replies to mail that needs one. Edit in place,
          then send — nothing leaves without your click.
        </p>
      </header>

      {metrics && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{rate}</span>
            <span className={styles.metricLabel}>draft-sent rate · 7d</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{metrics.sent}</span>
            <span className={styles.metricLabel}>
              sent ({metrics.sent_as_is} as-is · {metrics.sent_edited} edited)
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricNum}>
              {fmtSavedTime(metrics.est_minutes_saved)}
            </span>
            <span className={styles.metricLabel}>est. time saved</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{metrics.pending}</span>
            <span className={styles.metricLabel}>pending</span>
          </div>
        </div>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
      {err && <div className={styles.err}>{err}</div>}

      {drafts === null && <div className={styles.hint}>Loading drafts…</div>}
      {drafts !== null && drafts.length === 0 && (
        <div className={styles.empty}>
          No reply drafts waiting. When mail needs a reply, Astra stages one
          here before 1 PM — you’ll get a WhatsApp nudge.
        </div>
      )}

      <div className={styles.list}>
        {drafts?.map((d) => {
          const b = busy[d.id] || "";
          const sending = b === "send";
          const anyBusy = b !== "";
          return (
            <article key={d.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.to}>{fmtRecipient(d.to_addresses)}</div>
                <div className={styles.subject}>{d.subject || "(no subject)"}</div>
              </div>

              <textarea
                className={styles.body}
                value={edited[d.id] ?? d.body_text}
                onChange={(e) =>
                  setEdited((prev) => ({ ...prev, [d.id]: e.target.value }))
                }
                rows={Math.min(
                  18,
                  Math.max(5, (edited[d.id] ?? d.body_text).split("\n").length + 1),
                )}
                spellCheck
              />

              {refineOpen[d.id] && (
                <div className={styles.refineRow}>
                  <input
                    className={styles.refineInput}
                    placeholder="How should Astra revise it? e.g. shorter, warmer, add that we ship in 2 weeks"
                    value={refineText[d.id] ?? ""}
                    onChange={(e) =>
                      setRefineText((t) => ({ ...t, [d.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doRefine(d);
                    }}
                  />
                  <button
                    className={styles.btnGhost}
                    disabled={anyBusy || !(refineText[d.id] ?? "").trim()}
                    onClick={() => doRefine(d)}
                  >
                    {b === "refine" ? "revising…" : "revise"}
                  </button>
                </div>
              )}

              <div className={styles.actions}>
                <button
                  className={styles.btnPrimary}
                  disabled={anyBusy}
                  onClick={() => doSend(d)}
                >
                  {sending ? "sending…" : "Approve & Send"}
                </button>
                <button
                  className={styles.btnGhost}
                  disabled={anyBusy}
                  onClick={() =>
                    setRefineOpen((o) => ({ ...o, [d.id]: !o[d.id] }))
                  }
                >
                  Refine
                </button>
                <button
                  className={styles.btnDanger}
                  disabled={anyBusy}
                  onClick={() => doDiscard(d)}
                >
                  {b === "discard" ? "…" : "Discard"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
