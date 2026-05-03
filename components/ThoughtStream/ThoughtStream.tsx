"use client";

import styles from "./ThoughtStream.module.css";
import { useChat } from "@/components/ChatProvider";

/**
 * ThoughtStream — telemetry-style reasoning indicator.
 *
 * Old behavior was a stack of italic-serif thoughts in the center column,
 * which visually piled on top of the ResponsePane and made everything
 * unreadable when Astra produced a long thought trail.
 *
 * New behavior: a small monospace strip in the top-left corner, fixed
 * just under the "astra" wordmark. Shows ONLY the latest thought (older
 * ones rotate out as new ones arrive). Stays out of the way; never
 * occludes the chat or response pane.
 *
 * Why latest-only: streaming UIs that show full thought history are
 * great for debugging but exhausting to read. The user gets the most
 * current "what's astra doing now" signal — which is what they actually
 * want during a long-running turn.
 */
export function ThoughtStream() {
  const { thoughts, isStreaming } = useChat();

  // Only the most recent thought. Older ones are kept in `thoughts`
  // for audit/debug purposes but the UI stays minimal.
  const latest = thoughts.length > 0 ? thoughts[thoughts.length - 1] : null;

  if (!latest) return null;

  return (
    <div
      className={styles.stream}
      data-streaming={isStreaming}
      aria-live="polite"
    >
      <span className={styles.label}>thinking</span>
      <span className={styles.dot} aria-hidden />
      <p key={latest.id} className={styles.thought}>
        {latest.text}
      </p>
    </div>
  );
}
