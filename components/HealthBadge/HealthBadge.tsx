"use client";

import { useEffect, useState } from "react";
import styles from "./HealthBadge.module.css";

/**
 * HealthBadge — single-pixel-of-truth health indicator.
 *
 * Polls /api/health/deep every 30s. Renders a tiny status dot in
 * the top-right of the canvas:
 *   ok        → faint primary glow, slow pulse
 *   degraded  → amber dot, no pulse
 *   down      → red dot, fast pulse
 *
 * Hover to see the failing checks. Click to navigate to /audit
 * (where deeper diagnostics live).
 *
 * Goal: kunal sees "anything's degraded" before typing a prompt.
 * Replaces the "discover problems by hitting them" model.
 */

type Status = "ok" | "degraded" | "down" | "unknown";

interface HealthCheck {
  name: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
  duration_ms: number;
}

interface HealthResponse {
  status: Status;
  probedAt: string;
  checks: HealthCheck[];
}

const POLL_MS = 30_000;

export function HealthBadge() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch("/api/health/deep", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
        } else {
          setData(await r.json());
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const status: Status = error ? "unknown" : data?.status ?? "unknown";
  const failing =
    data?.checks.filter((c) => c.status !== "ok") ?? [];

  const className =
    status === "ok"
      ? styles.dotOk
      : status === "degraded"
        ? styles.dotDegraded
        : status === "down"
          ? styles.dotDown
          : styles.dotUnknown;

  return (
    <div
      className={styles.wrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={
        status === "ok"
          ? "all systems ok"
          : `${status} — ${failing.length} check(s) need attention`
      }
    >
      <span className={`${styles.dot} ${className}`} aria-hidden />

      {hover && (
        <div className={styles.pop}>
          <div className={styles.popHead}>
            system · <strong>{status}</strong>
          </div>
          {(data?.checks ?? []).map((c) => (
            <div key={c.name} className={styles.row}>
              <span
                className={`${styles.rowDot} ${
                  c.status === "ok"
                    ? styles.dotOk
                    : c.status === "degraded"
                      ? styles.dotDegraded
                      : styles.dotDown
                }`}
                aria-hidden
              />
              <span className={styles.rowName}>{c.name}</span>
              {c.detail && (
                <span className={styles.rowDetail}>· {c.detail}</span>
              )}
            </div>
          ))}
          {error && <div className={styles.errLine}>error: {error}</div>}
          {data?.probedAt && (
            <div className={styles.foot}>
              probed {new Date(data.probedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
