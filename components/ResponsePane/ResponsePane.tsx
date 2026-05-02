"use client";

import { useEffect, useRef } from "react";
import styles from "./ResponsePane.module.css";
import { useChat } from "@/components/ChatProvider";
import { ArtifactView } from "@/components/Artifacts/Artifact";
import { renderInline } from "./renderLite";

/**
 * ResponsePane — where Astra's answer appears after the thinking phase.
 *
 * Floats above the canvas when the response arrives. Editorial-mode
 * styling: oversized first line in italic serif, body in comfortable
 * sans-serif, mono for numbers.
 *
 * For Phase 3 we render plain text with light markdown cues. Rich
 * artifacts land in Phase 4.
 */
export function ResponsePane() {
  const { response, lastPrompt, error, isStreaming, lastDurationMs, reset, artifacts } =
    useChat();
  const paneRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep the last line visible while streaming. Scrolling now lives on
  // the pane itself (so artifacts + body scroll together), so we scroll
  // the pane rather than the body.
  useEffect(() => {
    if (!paneRef.current) return;
    paneRef.current.scrollTop = paneRef.current.scrollHeight;
  }, [response]);

  if (!lastPrompt && !response && !error && artifacts.length === 0) return null;

  return (
    <section ref={paneRef} className={styles.pane} aria-live="polite">
      <header className={styles.head}>
        <div className={styles.meta}>
          <span className={styles.tag}>you</span>
          {!isStreaming && lastDurationMs !== null && (
            <span className={styles.dur}>· answered in {(lastDurationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        {lastPrompt && <p className={styles.prompt}>{lastPrompt}</p>}
      </header>

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
