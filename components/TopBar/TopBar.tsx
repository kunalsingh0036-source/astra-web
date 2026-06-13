"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./TopBar.module.css";
import { HomeLink } from "@/components/HomeLink";
import { useFleetState } from "@/lib/useFleetState";
import { useSharedPoll } from "@/lib/pollResource";
import { mergeFleet } from "@/lib/mergeFleet";
import { useMode } from "@/components/ModeProvider";

/**
 * TopBar — wordmark always, detail chrome only in Ops mode.
 *
 * Monastic / Editorial: just the wordmark. Canvas is sacred.
 * Ops (⌘3): summons the old detail row — time, fleet count,
 * today's spend, status pulse. Gives the user a way to pull up
 * information density on demand without it being permanent noise.
 */

type CostSnap = {
  today_cost_usd: number;
  total_cost_usd: number;
  turns: number;
};

export function TopBar() {
  const { mode } = useMode();
  const isOps = mode === "ops";

  const [now, setNow] = useState<Date | null>(null);
  const { state } = useFleetState();

  useEffect(() => {
    if (!isOps) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isOps]);

  const agents = mergeFleet(state);
  const active = agents.filter(
    (a) => a.status === "active" || a.status === "pulsing",
  ).length;
  const statusLabel = state?.degraded
    ? "degraded"
    : state?.bridge.reachable
      ? "nominal"
      : "offline";

  if (!isOps) {
    // Monastic/editorial — wordmark + a single subtle nav affordance
    // for chat history. /sessions was unreachable from canvas chrome
    // (only via deterministic InputLine intercepts), making it
    // effectively invisible to anyone who didn't know the magic
    // phrase. Low-contrast glow-whisper keeps it from competing
    // with the wordmark while still being one click away.
    return (
      <header className={styles.topbar}>
        <div className={styles.leftCol}>
          <HomeLink className={styles.mark} />
          <Link
            href="/sessions"
            className={styles.navLink}
            title="all past chats"
          >
            sessions
          </Link>
        </div>
      </header>
    );
  }

  // Ops mode — the old full detail row.
  return (
    <header className={styles.topbar}>
      <div className={styles.leftCol}>
        <HomeLink className={styles.mark} />
        <Link
          href="/sessions"
          className={styles.navLink}
          title="all past chats"
        >
          sessions
        </Link>
        <OpsCost />
      </div>

      <div className={styles.center}>
        {now && (
          <>
            <div className={styles.time}>
              <b>{formatDate(now)}</b> · {formatTime(now)}
            </div>
            <div className={styles.sub}>
              {agents.length} agents · {active} active
            </div>
          </>
        )}
      </div>

      <div
        className={`${styles.status} ${statusLabel !== "nominal" ? styles.attention : ""}`}
      >
        <span className={styles.dot} />
        <span>fleet {statusLabel}</span>
      </div>
    </header>
  );
}

async function fetchCost(): Promise<CostSnap> {
  const r = await fetch("/api/cost?days=30", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as CostSnap;
}

/**
 * OpsCost — today's spend chip. Mounted ONLY in ops mode, so its
 * shared poll exists only while the detail row is visible; it pauses
 * when the tab is hidden (useSharedPoll's visibility-gating) and is
 * torn down the moment you leave ops mode.
 */
function OpsCost() {
  const { value: cost } = useSharedPoll<CostSnap>(
    "topbar-cost",
    fetchCost,
    60_000,
  );
  if (!cost) return null;
  return (
    <Link
      href="/cost"
      className={styles.cost}
      title={`${cost.turns} turns · 30d ${fmtUsd(cost.total_cost_usd)}`}
    >
      today {fmtUsd(cost.today_cost_usd)}
    </Link>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function formatDate(d: Date) {
  return d
    .toLocaleDateString("en-US", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    })
    .toLowerCase();
}

function formatTime(d: Date) {
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} ist`;
}
