"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ResponsePane.module.css";
import { useChat, type ToolActivity } from "@/components/ChatProvider";
import { ArtifactView } from "@/components/Artifacts/Artifact";
import { renderInline } from "./renderLite";


/**
 * Live status footer for an in-flight turn.
 *
 * Shows: elapsed seconds (ticking every 1s) · tools count · thoughts
 * count · current running tool name · stalled-warning if no event
 * arrived in the last STALL_THRESHOLD_MS.
 *
 * The point: when Astra is grinding on a long task ("study this
 * website completely"), the user needs a visible heartbeat so they
 * know progress is happening rather than the connection being dead.
 */
const STALL_THRESHOLD_MS = 30_000; // 30s with no event = "stalled"

function StreamStatus({
  startedAt,
  lastEventAt,
  tools,
  thoughtCount,
}: {
  startedAt: number | null;
  lastEventAt: number | null;
  tools: ToolActivity[];
  thoughtCount: number;
}) {
  // Tick once per second so the elapsed-time display updates even
  // when no events are flowing through.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!startedAt) return null;

  const now = Date.now();
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const sinceLastEventMs = lastEventAt ? now - lastEventAt : 0;
  const isStalled = lastEventAt !== null && sinceLastEventMs > STALL_THRESHOLD_MS;
  const runningTool = tools.find((t) => t.state === "running");
  const completedTools = tools.filter((t) => t.state !== "running").length;

  // Format elapsed: "12s" / "2m 5s"
  let elapsedLabel: string;
  if (elapsedSec < 60) {
    elapsedLabel = `${elapsedSec}s`;
  } else {
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    elapsedLabel = s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  return (
    <div
      className={`${styles.status} ${isStalled ? styles.statusStalled : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.statusDot} aria-hidden />
      <span className={styles.statusElapsed}>{elapsedLabel}</span>
      {tools.length > 0 && (
        <>
          <span className={styles.statusSep}>·</span>
          <span className={styles.statusCount}>
            {completedTools}/{tools.length}{" "}
            {tools.length === 1 ? "tool" : "tools"}
          </span>
        </>
      )}
      {thoughtCount > 0 && (
        <>
          <span className={styles.statusSep}>·</span>
          <span className={styles.statusCount}>
            {thoughtCount} {thoughtCount === 1 ? "thought" : "thoughts"}
          </span>
        </>
      )}
      {runningTool && (
        <>
          <span className={styles.statusSep}>·</span>
          <span className={styles.statusRunning}>
            running <em>{runningTool.name.replace(/^mcp__/, "")}</em>
          </span>
        </>
      )}
      {isStalled && (
        <>
          <span className={styles.statusSep}>·</span>
          <span className={styles.statusStallText}>
            no activity for {Math.floor(sinceLastEventMs / 1000)}s
          </span>
        </>
      )}
    </div>
  );
}

/**
 * ResponsePane — the conversation surface for the current session.
 *
 * Renders EVERY completed turn in the session, oldest first, with the
 * in-flight turn at the bottom. The pane scrolls so the user can walk
 * back through earlier exchanges within the same session — what Kunal
 * asked Astra two messages ago is right there above the latest answer.
 *
 * Each turn shows:
 *   - "you · answered in Xs" header
 *   - the user's prompt (italic-serif, smaller)
 *   - Astra's response (italic-serif, full size)
 *   - artifacts attached to that turn
 *
 * Reasoning lives inside the in-flight turn as a collapsible disclosure
 * (default closed). Historical turns drop the thought trail to keep the
 * pane compact — the audit log is the canonical record for past
 * reasoning if the user needs to walk back through it.
 */
export function ResponsePane() {
  const {
    response,
    lastPrompt,
    error,
    isStreaming,
    lastDurationMs,
    reset,
    artifacts,
    thoughts,
    history,
    tools,
    turnStartedAt,
    lastEventAt,
  } = useChat();
  const paneRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  // When a NEW turn starts (history.length changes OR a new prompt
  // is set), scroll the latest turn's TOP into view — not the bottom.
  // The user reads top-to-bottom at their own pace.
  //
  // We deliberately do NOT auto-follow text_delta streaming — chasing
  // the bottom while the response grows means the user can never
  // start reading from the top of a long response. They scroll down
  // when they're ready.
  const turnCount = history.length + (lastPrompt && isStreaming ? 1 : 0);
  useEffect(() => {
    if (!paneRef.current) return;
    const articles = paneRef.current.querySelectorAll("article");
    const latest = articles[articles.length - 1];
    if (latest) {
      latest.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [turnCount, lastPrompt]);

  if (
    !lastPrompt &&
    !response &&
    !error &&
    artifacts.length === 0 &&
    history.length === 0
  )
    return null;

  const hasReasoning = thoughts.length > 0;
  // Live "thinking" indicator: only while streaming AND no response
  // chars yet. Once the response starts, the streaming response itself
  // signals progress; the indicator becomes redundant.
  const showLiveThinking = isStreaming && !response && !error;

  // Render the in-flight turn ONLY while it's actively streaming or
  // errored. After `done` fires the most recent turn lives in `history`;
  // rendering it twice would duplicate.
  const showCurrentTurnInFlight = isStreaming || Boolean(error);

  return (
    <section ref={paneRef} className={styles.pane} aria-live="polite">
      {/* Conversation history — every completed turn in the session. */}
      {history.map((turn, i) => {
        const isLatest = i === history.length - 1;
        return (
          <article
            key={turn.id}
            className={`${styles.turn} ${
              isLatest ? styles.turnLatest : styles.turnOlder
            }`}
          >
            <header className={styles.turnHead}>
              <span className={styles.tag}>you</span>
              {turn.durationMs !== null && (
                <span className={styles.dur}>
                  · answered in {(turn.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              {turn.interrupted && (
                <span className={styles.interruptedChip}>
                  · interrupted — partial response recovered
                </span>
              )}
            </header>
            <p className={styles.prompt}>{turn.prompt}</p>
            {turn.response && (
              <div className={styles.body}>{renderInline(turn.response)}</div>
            )}
            {turn.artifacts.map((a, j) => (
              <ArtifactView key={`hist-${turn.id}-${j}`} artifact={a} />
            ))}
          </article>
        );
      })}

      {/* Current turn — only while in flight, otherwise it's already
          in `history`. Carries the live thinking indicator and the
          collapsible reasoning disclosure for THIS turn. */}
      {showCurrentTurnInFlight && lastPrompt && (
        <article className={`${styles.turn} ${styles.turnCurrent}`}>
          <header className={styles.turnHead}>
            <span className={styles.tag}>you</span>
            {!isStreaming && lastDurationMs !== null && (
              <span className={styles.dur}>
                · answered in {(lastDurationMs / 1000).toFixed(1)}s
              </span>
            )}
          </header>
          <p className={styles.prompt}>{lastPrompt}</p>

          {/* Live status footer — heartbeat for long-running turns.
              Always visible while streaming; carries elapsed time,
              tool/thought counts, currently-running tool, and a
              stalled warning if no event has arrived in 30s. */}
          {isStreaming && (
            <StreamStatus
              startedAt={turnStartedAt}
              lastEventAt={lastEventAt}
              tools={tools}
              thoughtCount={thoughts.length}
            />
          )}

          {showLiveThinking && !tools.length && (
            <div className={styles.thinking}>
              <span className={styles.thinkingDot} aria-hidden />
              <span className={styles.thinkingLabel}>astra is thinking</span>
            </div>
          )}

          {hasReasoning && (
            <div className={styles.reasoning}>
              <button
                type="button"
                className={styles.reasoningToggle}
                onClick={() => setReasoningOpen((v) => !v)}
                aria-expanded={reasoningOpen}
              >
                <span className={styles.reasoningCaret} aria-hidden>
                  {reasoningOpen ? "▾" : "▸"}
                </span>
                <span>
                  {reasoningOpen ? "hide" : "show"} reasoning
                  <span className={styles.reasoningCount}>
                    {" · "}
                    {thoughts.length}{" "}
                    {thoughts.length === 1 ? "thought" : "thoughts"}
                  </span>
                </span>
              </button>
              {reasoningOpen && (
                <ol className={styles.reasoningList}>
                  {thoughts.map((t, i) => (
                    <li key={t.id} className={styles.reasoningItem}>
                      <span className={styles.reasoningIndex}>{i + 1}</span>
                      <span className={styles.reasoningText}>{t.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {response && (
            <div ref={bodyRef} className={styles.body}>
              {renderInline(response)}
            </div>
          )}

          {artifacts.map((a, i) => (
            <ArtifactView key={`${a.kind}-${i}`} artifact={a} />
          ))}
        </article>
      )}

      {!isStreaming && (response || error || history.length > 0) && (
        <button type="button" className={styles.dismiss} onClick={reset}>
          dismiss conversation
        </button>
      )}
    </section>
  );
}
