"use client";

import styles from "./ThoughtStream.module.css";
import { useChat } from "@/components/ChatProvider";
import { useMode } from "@/components/ModeProvider";

/**
 * ThoughtStream — the italic-serif reasoning trace that appears
 * above the response pane while Astra is thinking.
 *
 * Mode behavior:
 *   - monastic: only the latest thought, nothing stale.
 *     (one thing at a time is the whole point of monastic.)
 *   - editorial (default): current + a few fading stale lines.
 *   - ops: same as editorial.
 */
export function ThoughtStream() {
  const { thoughts, isStreaming } = useChat();
  const { mode } = useMode();

  if (thoughts.length === 0) return null;

  const visible = mode === "monastic" ? thoughts.slice(0, 1) : thoughts;

  return (
    <div
      className={styles.stream}
      data-streaming={isStreaming}
      aria-live="polite"
    >
      {visible.map((t, i) => (
        <p
          key={t.id}
          className={`${styles.thought} ${t.stale ? styles.stale : ""}`}
          style={{ animationDelay: `${i * 30}ms` }}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}
