"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./ActivityFeed.module.css";
import type { AgentName } from "@/lib/types";

/**
 * Live activity feed for an agent room.
 *
 * Two visible sections:
 *
 *   1. RUNNING NOW — turns that haven't finished yet. The user sees
 *      the in-flight prompt, the tool count so far, and how long it's
 *      been running. This is the heartbeat answer to "is the agent
 *      doing something?"
 *
 *   2. RECENT — last 24h of audit events that touched this agent.
 *      Tool calls, decisions, durations. Compact timeline.
 *
 * Polling cadence: 4s. Faster than the snapshot refresh because this
 * is the surface most likely to change in real time.
 */

interface AuditEventRow {
  id: number;
  ts: string;
  tool_name: string;
  decision: string;
  action_tier: string;
  tool_input_summary: string;
}

interface TurnRow {
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
}

interface ActivityResponse {
  agent: AgentName;
  events: AuditEventRow[];
  runningTurns: TurnRow[];
  recentTurns: TurnRow[];
  probedAt: string;
}

const POLL_MS = 4_000;

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
  return `${day}d ago`;
}

function shortToolName(name: string): string {
  // mcp__astra-email__email_unanswered → email · email_unanswered
  const m = name.match(/^mcp__astra-([a-z_-]+)__(.+)$/);
  if (m) return `${m[1]} · ${m[2]}`;
  // Internal tools like TodoWrite — leave as-is
  return name;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function ActivityFeed({ agent }: { agent: AgentName }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/agent/${agent}/activity`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as ActivityResponse;
          setData(json);
          setLoadedAt(Date.now());
        }
      } catch {
        /* swallow — next tick will retry */
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_MS);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agent]);

  // Tick every second so the relative timestamps stay live without
  // waiting for the next poll. Cheap — just a render trigger.
  const [, forceRender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return (
      <section className={styles.feed}>
        <header className={styles.feedHead}>
          <span className={styles.feedTitle}>activity</span>
          <span className={styles.feedMeta}>connecting…</span>
        </header>
      </section>
    );
  }

  const hasRunning = data.runningTurns.length > 0;
  const hasEvents = data.events.length > 0;
  const hasRecent = data.recentTurns.length > 0;
  const isFresh = Date.now() - loadedAt < POLL_MS * 2;

  return (
    <section className={styles.feed}>
      <header className={styles.feedHead}>
        <span className={styles.feedTitle}>activity</span>
        <span className={styles.feedMeta}>
          <span
            className={`${styles.dot} ${isFresh ? styles.dotLive : styles.dotStale}`}
            aria-hidden
          />
          {isFresh ? "live" : "stale"} · refreshed {formatRelativeTime(data.probedAt)}
        </span>
      </header>

      {/* RUNNING — what astra is doing right now */}
      {hasRunning && (
        <div className={styles.runningBlock}>
          <div className={styles.runningLabel}>working on it</div>
          {data.runningTurns.map((t) => {
            const elapsedSec = Math.round(
              (Date.now() - new Date(t.started_at).getTime()) / 1000,
            );
            return (
              <article key={t.id} className={styles.running}>
                <div className={styles.runningTop}>
                  <span className={styles.runningPulse} aria-hidden />
                  <span className={styles.runningTime}>
                    {elapsedSec < 60
                      ? `${elapsedSec}s`
                      : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`}
                  </span>
                  <span className={styles.runningTools}>
                    · {t.tool_count} tool{t.tool_count === 1 ? "" : "s"}
                  </span>
                </div>
                <p className={styles.runningPrompt}>{truncate(t.prompt, 200)}</p>
              </article>
            );
          })}
        </div>
      )}

      {/* RECENT — completed turns mentioning this agent */}
      {hasRecent && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>recent conversations</div>
          <ul className={styles.turnList}>
            {data.recentTurns.slice(0, 4).map((t) => (
              <li key={t.id} className={styles.turnItem}>
                <span
                  className={`${styles.statusPip} ${
                    t.status === "complete"
                      ? styles.pipOk
                      : t.status === "failed"
                        ? styles.pipFail
                        : styles.pipMuted
                  }`}
                  aria-hidden
                />
                <div className={styles.turnText}>
                  <p className={styles.turnPrompt}>{truncate(t.prompt, 120)}</p>
                  <p className={styles.turnMeta}>
                    {formatRelativeTime(t.started_at)}
                    {t.duration_ms !== null && (
                      <> · {(t.duration_ms / 1000).toFixed(1)}s</>
                    )}
                    {t.tool_count > 0 && (
                      <> · {t.tool_count} tool{t.tool_count === 1 ? "" : "s"}</>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* TOOL TIMELINE — last 24h of audit events */}
      {hasEvents && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>tool calls (24h)</div>
          <ul className={styles.eventList}>
            {data.events.slice(0, 12).map((e) => (
              <li key={e.id} className={styles.event}>
                <span className={styles.eventTime}>
                  {formatRelativeTime(e.ts)}
                </span>
                <span className={styles.eventTool}>
                  {shortToolName(e.tool_name)}
                </span>
                <span
                  className={`${styles.eventDecision} ${
                    e.decision === "allow"
                      ? styles.decisionOk
                      : e.decision === "deny"
                        ? styles.decisionDeny
                        : styles.decisionAsk
                  }`}
                >
                  {e.decision}
                </span>
              </li>
            ))}
          </ul>
          {data.events.length > 12 && (
            <Link href="/audit" className={styles.moreLink}>
              {data.events.length - 12} more in /audit →
            </Link>
          )}
        </div>
      )}

      {/* EMPTY — nothing happened in the last 24h */}
      {!hasRunning && !hasRecent && !hasEvents && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            quiet on this agent for the last 24 hours.
          </p>
          <p className={styles.emptyHint}>
            ask astra to do something here, and it&apos;ll appear in real time.
          </p>
        </div>
      )}
    </section>
  );
}
