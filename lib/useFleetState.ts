"use client";

import type { FleetState } from "./fleet";
import { useSharedPoll } from "./pollResource";

/**
 * useFleetState — fleet health from /api/state.
 *
 * Backed by useSharedPoll, which gives us two things the old per-hook
 * setInterval didn't (UX audit 2026-06-13):
 *   - Dedup: this hook mounts in BOTH Canvas and TopBar. They now share
 *     ONE /api/state poll instead of opening two identical 10s loops.
 *   - Visibility-gating: the poll pauses while the tab is hidden and
 *     catches up the moment it's seen again.
 *
 * Still no SWR/Tanstack — useSharedPoll is the minimal primitive for
 * exactly these needs and keeps the dep tree small.
 */

const POLL_MS = 10_000;

const FLEET_KEY = "fleet-state";

async function fetchFleet(): Promise<FleetState> {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as FleetState;
}

export function useFleetState() {
  const { value, loading, error } = useSharedPoll<FleetState>(
    FLEET_KEY,
    fetchFleet,
    POLL_MS,
  );
  return { state: value, loading, error };
}

// Exported so other consumers (e.g. useSignals) can ride the SAME
// shared /api/state poll instead of opening their own.
export { FLEET_KEY, fetchFleet };
