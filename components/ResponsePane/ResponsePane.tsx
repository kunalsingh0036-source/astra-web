"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ResponsePane.module.css";
import { useChat } from "@/components/ChatProvider";
import { ArtifactView } from "@/components/Artifacts/Artifact";
import { renderInline } from "./renderLite";

/**
 * ResponsePane — Astra's reasoning + answer, both inside one container.
 *
 * The OLD design had a separate ThoughtStream component that floated
 * truncated half-sentences in the top-left corner during streaming.
 * Useless: the user couldn't read the full reasoning, the truncation
 * created anxiety, and the strip duplicated the "thinking — esc to
 * stop" indicator already shown in the input dock.
 *
 * The NEW design folds reasoning INTO this pane as a collapsible
 * "show reasoning" disclosure. Default collapsed; click to expand
 * the full thought trail with proper monospace + complete sentences.
 *
 *   Default              → response only.
 *   Streaming, no answer → "astra is thinking" indicator.
 *   Reasoning available  → "show reasoning · N" disclosure (collapsed).
 *   User clicks expand   → full ordered list of thoughts, scrollable.
 *
 * Rationale: thinking is reference material, not a primary signal.
 * Show on demand, not by default.
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
  } = useChat();
  const paneRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  // Keep the last line visible while streaming. Scrolling now lives on
  // the pane itself (so artifacts + body scroll together), so we scroll
  // the pane rather than the body.
  useEffect(() => {
    if (!paneRef.current) return;
    paneRef.current.scrollTop = paneRef.current.scrollHeight;
  }, [response]);

  if (!lastPrompt && !response && !error && artifacts.length === 0) return null;

  // Reasoning is available whenever any thoughts have streamed in.
  const hasReasoning = thoughts.length > 0;
  // Live "thinking" indicator: only while streaming AND no response
  // chars yet. Once the response starts, the streaming response itself
  // signals progress; the indicator becomes redundant.
  const showLiveThinking = isStreaming && !response && !error;

  return (
    <section ref={paneRef} className={styles.pane} aria-live="polite">
      <header className={styles.head}>
        <div className={styles.meta}>
          <span className={styles.tag}>you</span>
          {!isStreaming && lastDurationMs !== null && (
            <span className={styles.dur}>
              · answered in {(lastDurationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {lastPrompt && <p className={styles.prompt}>{lastPrompt}</p>}
      </header>

      {/* Live thinking indicator — replaces the truncated top-left
          ThoughtStream. Just a label + pulsing dot, no half-sentence
          text. Full reasoning is one click away via the disclosure
          below as soon as thoughts arrive. */}
      {showLiveThinking && (
        <div className={styles.thinking}>
          <span className={styles.thinkingDot} aria-hidden />
          <span className={styles.thinkingLabel}>astra is thinking</span>
        </div>
      )}

      {/* Reasoning disclosure — collapsible, visible whenever any
          thoughts have streamed in. Default-collapsed so the pane
          stays focused on the response. Click to expand a full
          monospace list of thoughts in order, with no truncation. */}
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

      {!isStreaming && (response || error) && (
        <button type="button" className={styles.dismiss} onClick={reset}>
          dismiss
        </button>
      )}
    </section>
  );
}
