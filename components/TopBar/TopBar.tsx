"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./TopBar.module.css";
import { HomeLink } from "@/components/HomeLink";
import { useFleetState } from "@/lib/useFleetState";
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
  const [cost, setCost] = useState<CostSnap | null>(null);
  const { state } = useFleetState();

  useEffect(() => {
    if (!isOps) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isOps]);

  useEffect(() => {
    if (!isOps) return;
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch("/api/cost?days=30", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as CostSnap;
        if (!cancelled) setCost(j);
      } catch {
        /* ambient — cost is nice-to-have */
      }
    }
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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
    return (
      <header className={styles.topbar}>
        <HomeLink className={styles.mark} />
      </header>
    );
  }

  // Ops mode — the old full detail row.
  return (
    <header className={styles.topbar}>
      <div className={styles.leftCol}>
        <HomeLink className={styles.mark} />
        {cost && (
          <Link
            href="/cost"
            className={styles.cost}
            title={`${cost.turns} turns · 30d ${fmtUsd(cost.total_cost_usd)}`}
          >
            today {fmtUsd(cost.today_cost_usd)}
          </Link>
        )}
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
