"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { use } from "react";
import styles from "./turn.module.css";
import { MarkdownView } from "@/components/ResponsePane/MarkdownView";

/**
 * /turns/[id] — single-turn deep link.
 *
 * Now that turns are durable rows with stable ids (Phase 2a/2b),
 * any specific run can be bookmarked, shared, or referenced.
 * Useful when you want to:
 *   - Send someone a link to "the time Astra wrote that PRD"
 *   - Re-read the exact response without scrolling through a long
 *     session history
 *   - See a turn that's still in flight on another device
 *
 * The page is read-only. To continue the conversation, click
 * "open session →" which jumps to / with the session_id loaded.
 *
 * Status semantics:
 *   - complete    — agent finished cleanly
 *   - running     — still in flight; we tail-poll until terminal
 *   - interrupted — client cancelled
 *   - failed      — runtime error
 *   - timeout     — exceeded hard cap
 */

interface TurnDetail {
  id: number;
  session_id: string | null;
  prompt: string;
  response: string | null;
  status: string;
  tool_count: number;
  duration_ms: number | null;
  cost_usd: string | null;
  started_at: string;
  ended_at: string | null;
  error_message: string | null;
}

interface PollEvent {
  ord: number;
  event: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function statusTone(s: string): "ok" | "warn" | "live" {
  if (s === "complete") return "ok";
  if (s === "running") return "live";
  return "warn";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function TurnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: params is a Promise — unwrap with React's `use()`.
  const { id } = use(params);
  const turnId = parseInt(id, 10);

  const [turn, setTurn] = useState<TurnDetail | null>(null);
  const [events, setEvents] = useState<PollEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch + tail-poll while running. The poll interval here
  // is generous (3s) because this page is for after-the-fact
  // viewing, not live driving — a few seconds of latency on a
  // running turn is fine. If it's already terminal, we stop after
  // one read.
  useEffect(() => {
    if (!Number.isFinite(turnId) || turnId <= 0) {
      setError("invalid turn id");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const [tRes, eRes] = await Promise.all([
          fetch(`/api/turns/${turnId}`, { cache: "no-store" }),
          fetch(`/api/turns/${turnId}/events?after=0`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (!tRes.ok) {
          const body = await tRes.json().catch(() => ({}));
          setError(body.error || `turn HTTP ${tRes.status}`);
          return;
        }
        const tJson = (await tRes.json()) as TurnDetail;
        const eJson = (await eRes.json().catch(() => ({}))) as {
          events?: PollEvent[];
          terminal?: boolean;
        };
        if (cancelled) return;
        setTurn(tJson);
        setEvents(eJson.events || []);
        // Stop tailing once the turn is terminal. Cheap heuristic:
        // running OR ended_at null AND status in non-terminal set.
        const terminal =
          eJson.terminal === true ||
          ["complete", "failed", "interrupted", "timeout"].includes(
            tJson.status,
          );
        if (!terminal) {
          timer = setTimeout(tick, 3000);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [turnId]);

  if (error) {
    return (
      <main className={styles.main}>
        <header className={styles.trail}>
          <Link href="/sessions">sessions</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>turn #{id}</span>
        </header>
        <p className={styles.errText}>error: {error}</p>
      </main>
    );
  }

  if (!turn) {
    return (
      <main className={styles.main}>
        <p className={styles.empty}>loading…</p>
      </main>
    );
  }

  const tone = statusTone(turn.status);

  // Distill the event log into "interesting" rows. We don't render
  // every text_delta (those are concatenated into turn.response
  // server-side anyway); just session/tool_call/tool_result/done/
  // error so the page reads as a timeline of decisions, not a
  // wall of micro-frames.
  const timeline = events.filter((e) =>
    ["session", "tool_call", "tool_result", "done", "error", "thought"].includes(
      e.event,
    ),
  );

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <Link href="/sessions">sessions</Link>
        <span className={styles.trailArrow}>/</span>
        {turn.session_id && (
          <>
            <Link href={`/?session=${encodeURIComponent(turn.session_id)}`}>
              {turn.session_id.slice(0, 8)}…
            </Link>
            <span className={styles.trailArrow}>/</span>
          </>
        )}
        <span className={styles.trailCurrent}>turn #{turn.id}</span>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>turn #{turn.id}</div>
        <h1 className={styles.prompt}>{turn.prompt}</h1>
        <div className={styles.meta}>
          <span
            className={`${styles.status} ${
              tone === "ok"
                ? styles.statusOk
                : tone === "live"
                  ? styles.statusLive
                  : styles.statusWarn
            }`}
          >
            {turn.status}
          </span>
          <span className={styles.metaDot}>·</span>
          <span>{formatDuration(turn.duration_ms)}</span>
          <span className={styles.metaDot}>·</span>
          <span>
            {turn.tool_count} tool{turn.tool_count === 1 ? "" : "s"}
          </span>
          {turn.cost_usd && (
            <>
              <span className={styles.metaDot}>·</span>
              <span>${parseFloat(turn.cost_usd).toFixed(4)}</span>
            </>
          )}
          <span className={styles.metaDot}>·</span>
          <span>{formatTimestamp(turn.started_at)}</span>
        </div>
      </section>

      {turn.error_message && (
        <section className={styles.errorBlock}>
          <div className={styles.errorLabel}>error</div>
          <p className={styles.errorBody}>{turn.error_message}</p>
        </section>
      )}

      <section className={styles.responseBlock}>
        <div className={styles.responseLabel}>response</div>
        {turn.response ? (
          <div className={styles.responseBody}>
            <MarkdownView text={turn.response} />
          </div>
        ) : (
          <p className={styles.empty}>(no response — turn ended without text)</p>
        )}
      </section>

      {timeline.length > 0 && (
        <section className={styles.timeline}>
          <div className={styles.timelineLabel}>timeline</div>
          <ul className={styles.events}>
            {timeline.map((e) => (
              <li key={e.ord} className={styles.event}>
                <span className={styles.evOrd}>#{e.ord}</span>
                <span className={styles.evName}>{e.event}</span>
                <span className={styles.evDetail}>
                  {summarizeEvent(e)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {turn.session_id && (
        <footer className={styles.footer}>
          <Link
            href={`/?session=${encodeURIComponent(turn.session_id)}`}
            className={styles.openSession}
          >
            open session →
          </Link>
        </footer>
      )}
    </main>
  );
}

/**
 * Compact one-line summary of an event for the timeline view. Keeps
 * the focus on signal, not noise: tool name + agent for tool_call,
 * preview for tool_result, etc.
 */
function summarizeEvent(e: PollEvent): string {
  const p = e.payload || {};
  switch (e.event) {
    case "session":
      return String(p.session_id || "").slice(0, 8) + "…";
    case "thought":
      return truncate(String(p.text || ""), 120);
    case "tool_call": {
      const name = String(p.name || "?");
      const agent = p.agent ? ` · ${p.agent}` : "";
      return `${name}${agent}`;
    }
    case "tool_result": {
      const ok = p.is_error ? "error" : "ok";
      const preview = truncate(String(p.preview || ""), 120);
      return preview ? `${ok} · ${preview}` : ok;
    }
    case "done": {
      const dur = p.duration_ms ? `${(Number(p.duration_ms) / 1000).toFixed(1)}s` : "";
      const cost = p.cost_usd ? ` · $${Number(p.cost_usd).toFixed(4)}` : "";
      return `${dur}${cost}`;
    }
    case "error":
      return truncate(String(p.message || "unknown error"), 200);
    default:
      return "";
  }
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
