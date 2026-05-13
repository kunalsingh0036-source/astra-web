"use client";

import { useEffect, useState } from "react";
import styles from "./HealthBadge.module.css";

/**
 * HealthBadge — single-pixel-of-truth health indicator.
 *
 * Polls /api/health/deep every 30s. Renders a tiny status dot in
 * the top-right of the canvas:
 *   ok          → faint primary glow, slow pulse
 *   cloud_only  → same faint glow (NOT alarm) — bridge offline is
 *                 normal when laptop is closed; the cloud agent is
 *                 fully functional. Tooltip explains the diff.
 *   degraded    → amber dot, no pulse (only for genuine cloud-side
 *                 partial failures, never just for a sleeping bridge)
 *   down        → red dot, fast pulse
 *
 * Hover to see the failing checks. Click to navigate to /audit.
 *
 * The "agent down" framing was scaring kunal whenever he closed the
 * laptop and the bridge daemon stopped polling. The cloud agent is
 * always-on on Railway — laptop state never breaks chat. The new
 * cloud_only state surfaces this honestly: "everything works, but
 * the local-file arm is asleep."
 */

type Status = "ok" | "cloud_only" | "degraded" | "down" | "unknown";

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
  // cloud_only is intentionally NOT in the "failing" list — it's a
  // normal operating mode (laptop closed), not a partial failure.
  const failing =
    data?.checks.filter(
      (c) => c.status !== "ok" && c.name !== "bridge_daemon",
    ) ?? [];

  // Map status → visual class. cloud_only renders identically to ok
  // because there's nothing wrong; only the tooltip text changes.
  const className =
    status === "ok" || status === "cloud_only"
      ? styles.dotOk
      : status === "degraded"
        ? styles.dotDegraded
        : status === "down"
          ? styles.dotDown
          : styles.dotUnknown;

  // Human-readable label for the status. The dropdown header uses
  // this; "cloud_only" is jargon and shouldn't surface raw to the
  // user.
  const statusLabel: Record<Status, string> = {
    ok: "all systems ok",
    cloud_only: "cloud ok · laptop tools paused",
    degraded: "degraded",
    down: "down",
    unknown: "checking…",
  };

  // Hover-card title. Short enough to fit in a native tooltip.
  const titleText =
    status === "ok"
      ? "all systems ok"
      : status === "cloud_only"
        ? "cloud agent ok — local-file tools paused (laptop sleeping)"
        : status === "degraded"
          ? `degraded — ${failing.length} cloud check(s) need attention`
          : status === "down"
            ? "system down"
            : "status unknown";

  return (
    <div
      className={styles.wrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={titleText}
    >
      <span className={`${styles.dot} ${className}`} aria-hidden />

      {hover && (
        <div className={styles.pop}>
          <div className={styles.popHead}>
            system · <strong>{statusLabel[status]}</strong>
          </div>
          {status === "cloud_only" && (
            <div className={styles.popExplain}>
              Cloud agent is fully operational. Local-file tools
              (`local_read`, `screenshot_url`, etc.) resume when the
              laptop wakes — chat, memory, email, calendar all work
              regardless.
            </div>
          )}
          {(data?.checks ?? []).map((c) => {
            // Reframe the bridge_daemon row in cloud_only mode so it
            // reads as "sleeping" not "broken".
            const isSleepingBridge =
              c.name === "bridge_daemon" &&
              c.status === "degraded" &&
              status === "cloud_only";
            const rowDotClass = isSleepingBridge
              ? styles.dotOk
              : c.status === "ok"
                ? styles.dotOk
                : c.status === "degraded"
                  ? styles.dotDegraded
                  : styles.dotDown;
            const stateWord = isSleepingBridge ? "sleeping" : c.status;
            return (
              <div key={c.name} className={styles.row}>
                <span
                  className={`${styles.rowDot} ${rowDotClass}`}
                  aria-hidden
                />
                <span className={styles.rowName}>{c.name}</span>
                <span className={styles.rowState}>· {stateWord}</span>
                {c.detail && (
                  <span className={styles.rowDetail}>· {c.detail}</span>
                )}
              </div>
            );
          })}
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
