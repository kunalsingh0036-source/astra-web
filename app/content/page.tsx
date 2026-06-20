"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./content.module.css";

/**
 * /content — the LinkedIn beachhead's human-in-the-loop surface.
 *
 * The daily 08:00 job drafts a LinkedIn post from the morning research
 * briefing's OUTWARD insight (internal roadmap stripped) and stages it
 * here. Kunal reads, edits in place, then Approve (= I'm shipping this,
 * the metric) / Copy (paste into LinkedIn) / Mark posted (with URL) /
 * Discard. Astra never posts on his behalf.
 */

interface Draft {
  id: number;
  title: string;
  content: {
    hook?: string;
    body?: string;
    hashtags?: string[];
    edited_text?: string;
    briefing_topic?: string;
    reason?: string;
  };
  status: string;
  created_at: string;
}

interface Metrics {
  window_days: number;
  drafted: number;
  approved: number;
  posted: number;
  rejected: number;
  pending: number;
  approval_rate: number | null;
  posts_per_week: number;
}

function composed(c: Draft["content"]): string {
  if (typeof c.edited_text === "string" && c.edited_text.trim()) {
    return c.edited_text;
  }
  const body = (c.body || "").trim();
  const tags = (c.hashtags || []).join(" ");
  return tags ? `${body}\n\n${tags}` : body;
}

export default function ContentPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await fetch("/api/content/metrics?days=7", {
        cache: "no-store",
      }).then((r) => r.json());
      if (!m.error) setMetrics(m);
    } catch {
      /* non-critical */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/content", { cache: "no-store" }).then((r) =>
        r.json(),
      );
      if (d.error) {
        setErr(d.error);
        setDrafts([]);
      } else {
        const rows: Draft[] = d.rows || [];
        setDrafts(rows);
        setEdited((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            if (next[r.id] === undefined) next[r.id] = composed(r.content);
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
  const drop = (id: number) =>
    setDrafts((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));

  const act = async (
    id: number,
    action: "approve" | "discard" | "posted",
    extra?: { posted_url?: string },
  ) => {
    setBusy((b) => ({ ...b, [id]: action }));
    setErr(null);
    try {
      const body =
        action === "discard"
          ? undefined
          : JSON.stringify({ text: edited[id], ...(extra || {}) });
      const r = await fetch(`/api/content/${id}/${action}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      drop(id);
      flash(
        action === "approve"
          ? "Approved — counts as shipped. Paste it into LinkedIn."
          : action === "posted"
            ? "Marked posted ✓"
            : "Discarded.",
      );
      loadMetrics();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  };

  const copy = async (id: number) => {
    try {
      await navigator.clipboard.writeText(edited[id] ?? "");
      flash("Copied — paste into LinkedIn.");
    } catch {
      flash("Copy failed — select the text manually.");
    }
  };

  const markPosted = (id: number) => {
    const url = window.prompt("LinkedIn post URL (optional — leave blank to skip):") || "";
    act(id, "posted", url.trim() ? { posted_url: url.trim() } : undefined);
  };

  const rate =
    metrics?.approval_rate != null
      ? `${Math.round(metrics.approval_rate * 100)}%`
      : "—";

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>content</span>
        </div>
        <Link href="/research" className={styles.trailRight}>
          research →
        </Link>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>LINKEDIN · DRAFTED FROM YOUR RESEARCH</div>
        <h1 className={styles.title}>Posts waiting</h1>
        <p className={styles.sub}>
          Drafted from the morning research in your voice. Edit in place, then
          Approve to count it shipped and Copy it into LinkedIn — Astra never
          posts for you.
        </p>
      </header>

      {metrics && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{metrics.approved}</span>
            <span className={styles.metricLabel}>shipped · 7d</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{metrics.posts_per_week}</span>
            <span className={styles.metricLabel}>posts / week</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricNum}>{rate}</span>
            <span className={styles.metricLabel}>approval rate</span>
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
          No posts waiting. The 08:00 job drafts one from the morning research
          when there’s a postable angle — you’ll get a WhatsApp nudge.
        </div>
      )}

      <div className={styles.list}>
        {drafts?.map((d) => {
          const b = busy[d.id] || "";
          const anyBusy = b !== "";
          const text = edited[d.id] ?? "";
          return (
            <article key={d.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>{d.title || "Untitled"}</div>
                {d.content.briefing_topic && (
                  <div className={styles.provenance}>
                    from: {d.content.briefing_topic}
                  </div>
                )}
              </div>

              <textarea
                className={styles.body}
                value={text}
                onChange={(e) =>
                  setEdited((prev) => ({ ...prev, [d.id]: e.target.value }))
                }
                rows={Math.min(20, Math.max(6, text.split("\n").length + 1))}
                spellCheck
              />
              <div className={styles.charCount}>{text.length} chars</div>

              <div className={styles.actions}>
                <button
                  className={styles.btnPrimary}
                  disabled={anyBusy}
                  onClick={() => act(d.id, "approve")}
                >
                  {b === "approve" ? "…" : "Approve (ship)"}
                </button>
                <button
                  className={styles.btnGhost}
                  disabled={anyBusy}
                  onClick={() => copy(d.id)}
                >
                  Copy
                </button>
                <button
                  className={styles.btnGhost}
                  disabled={anyBusy}
                  onClick={() => markPosted(d.id)}
                >
                  {b === "posted" ? "…" : "Mark posted"}
                </button>
                <button
                  className={styles.btnDanger}
                  disabled={anyBusy}
                  onClick={() => act(d.id, "discard")}
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
