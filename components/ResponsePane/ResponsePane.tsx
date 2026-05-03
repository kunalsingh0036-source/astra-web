"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ResponsePane.module.css";
import { useChat } from "@/components/ChatProvider";
import { ArtifactView } from "@/components/Artifacts/Artifact";
import { renderInline } from "./renderLite";

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
  } = useChat();
  const paneRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  // Auto-scroll while the current turn streams AND when a new turn
  // lands in history — both signal "show me what just happened."
  useEffect(() => {
    if (!paneRef.current) return;
    paneRef.current.scrollTop = paneRef.current.scrollHeight;
  }, [response, history.length]);

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

          {showLiveThinking && (
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
