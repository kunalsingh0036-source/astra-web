"use client";

import Link from "next/link";
import styles from "./AmbientSignals.module.css";
import { useSignals } from "@/lib/useSignals";
import { useMode } from "@/components/ModeProvider";

/**
 * AmbientSignals — italic-serif whispers that appear on the canvas
 * only when something needs attention. Silent when everything is
 * quiet, which is most of the time. Also silent in Monastic mode —
 * monastic is "one thing at a time, nothing ambient."
 */
export function AmbientSignals() {
  const { mode } = useMode();
  const signals = useSignals();
  if (mode === "monastic") return null;
  if (signals.length === 0) return null;

  return (
    <div className={styles.stream} aria-live="polite">
      {signals.map((s) => {
        const cls = `${styles.signal} ${s.alarm ? styles.alarm : ""}`;
        // A signal with a route becomes a tap-target straight to the
        // thing it's about (e.g. the approvals queue). Without one it
        // stays a passive whisper.
        return s.route ? (
          <Link key={s.id} href={s.route} className={cls}>
            {s.text}
          </Link>
        ) : (
          <p key={s.id} className={cls}>
            {s.text}
          </p>
        );
      })}
    </div>
  );
}
