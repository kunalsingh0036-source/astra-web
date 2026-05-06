"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./sessions.module.css";

/**
 * /sessions — every past chat, browseable + resumable.
 *
 * Each row shows the session's first prompt (its de-facto title),
 * relative time of last activity, turn count, and last status.
 * Click a row → navigate to / with `?session=<id>` so the chat
 * provider hydrates that session's history and the next ask flows
 * under the same session_id (lean runtime resumes server-side from
 * turns.messages).
 *
 * Filterable by free-text against the first prompt.
 */

interface Session {
  session_id: string;
  first_turn_at: string;
  last_turn_at: string;
  turn_count: number;
  first_prompt: string;
  last_status: string;
  last_response_head: string | null;
  /** Haiku-generated topic title. NULL when the background generator
   *  hasn't run yet (just-finished session) or generation failed.
   *  UI falls back to the truncated first_prompt in that case. */
  title: string | null;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.round(day / 7);
  if (week < 5) return `${week}w ago`;
  return new Date(iso).toLocaleDateString();
}

function statusLabel(s: string): { text: string; tone: "ok" | "warn" | "live" } {
  switch (s) {
    case "complete":
      return { text: "complete", tone: "ok" };
    case "running":
      return { text: "in flight", tone: "live" };
    case "interrupted":
      return { text: "interrupted", tone: "warn" };
    case "failed":
      return { text: "failed", tone: "warn" };
    case "timeout":
      return { text: "timed out", tone: "warn" };
    default:
      return { text: s || "—", tone: "warn" };
  }
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/sessions?limit=200", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as { sessions: Session[] };
        setSessions(json.sessions || []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick-update relative timestamps every 60s without a refetch
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        s.first_prompt.toLowerCase().includes(q) ||
        (s.last_response_head || "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>sessions</span>
        </div>
        <div className={styles.trailRight}>
          {sessions === null
            ? "loading…"
            : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>chat history</div>
        <h1 className={styles.title}>sessions.</h1>
        <p className={styles.summary}>
          Every past conversation with Astra. Click any row to resume —
          the chat picks up with the full message history, the same
          session id, and the agent's server-side memory of what you
          were working on.
        </p>
      </section>

      <section className={styles.controls}>
        <div className={styles.searchBar}>
          <span className={styles.searchPrompt}>q ·</span>
          <input
            className={styles.searchInput}
            placeholder="filter by prompt or response…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </section>

      {error && <p className={styles.errText}>error: {error}</p>}

      <section className={styles.list}>
        {sessions === null && !error && <p className={styles.empty}>—</p>}
        {sessions !== null && filtered.length === 0 && (
          <p className={styles.empty}>
            {query
              ? `no sessions match "${query}".`
              : "no sessions yet — start a chat from the canvas to populate this."}
          </p>
        )}
        {filtered.map((s) => {
          const status = statusLabel(s.last_status);
          return (
            <Link
              key={s.session_id}
              href={`/?session=${encodeURIComponent(s.session_id)}`}
              className={styles.row}
            >
              <div className={styles.rowMeta}>
                <span className={styles.rowTime}>
                  {formatRelativeTime(s.last_turn_at)}
                </span>
                <span className={styles.rowDot}>·</span>
                <span className={styles.rowCount}>
                  {s.turn_count} turn{s.turn_count === 1 ? "" : "s"}
                </span>
                <span className={styles.rowDot}>·</span>
                <span
                  className={`${styles.rowStatus} ${
                    status.tone === "ok"
                      ? styles.statusOk
                      : status.tone === "live"
                        ? styles.statusLive
                        : styles.statusWarn
                  }`}
                >
                  {status.text}
                </span>
              </div>
              {/* Title hierarchy:
                    1. Haiku-generated topic title (primary)
                    2. Truncated first prompt (muted subtitle)
                  When the title hasn't been generated yet (just-finished
                  session, or backfill not run), the first-prompt
                  promotes back to primary so the row stays usable. */}
              {s.title ? (
                <>
                  <p className={styles.rowTitle}>{s.title}</p>
                  <p className={styles.rowPrompt}>
                    {truncate(s.first_prompt, 200)}
                  </p>
                </>
              ) : (
                <p className={styles.rowTitle}>
                  {truncate(s.first_prompt, 220)}
                </p>
              )}
              {s.last_response_head && (
                <p className={styles.rowResponse}>
                  → {truncate(s.last_response_head, 200)}
                </p>
              )}
              <div className={styles.rowFooter}>
                <span className={styles.rowSession}>
                  {s.session_id.slice(0, 8)}…
                </span>
                <span className={styles.rowResume}>resume →</span>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
