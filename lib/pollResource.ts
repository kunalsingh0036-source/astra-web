"use client";

import { useEffect, useState } from "react";

/**
 * useSharedPoll — one poll, many subscribers, paused when unseen.
 *
 * Two wastes this kills, both found in the 2026-06-13 UX audit:
 *
 *   1. Duplicate polls. useFleetState mounts in BOTH Canvas and TopBar,
 *      each opening its own /api/state interval — two identical requests
 *      every 10s. Keying by a string collapses every subscriber of the
 *      same key onto ONE interval; new subscribers get the cached value
 *      immediately, no extra fetch.
 *
 *   2. Background polling. None of the old pollers checked
 *      document.hidden, so a backgrounded tab kept hitting the stream
 *      service and DB every 10–60s for a screen nobody was looking at.
 *      We pause every shared interval when the tab is hidden and do one
 *      immediate "catch-up" fetch the instant it becomes visible again
 *      (stale-on-return), so the UI is fresh by the time the eye lands.
 *
 * Deliberately not SWR/Tanstack — same reasoning as the hooks it
 * replaces: a handful of endpoints, no cache-keying beyond this, and a
 * small dep tree matters. ~80 lines buys exactly what we need.
 *
 * The fetcher is captured per key on first subscribe (callers pass a
 * stable fetcher per key — same endpoint, same shape).
 */

export interface PollSnapshot<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

interface Entry<T> {
  snap: PollSnapshot<T>;
  fetcher: () => Promise<T>;
  intervalMs: number;
  subs: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
}

// Module-level registry: one entry per key, shared across all hooks.
const registry = new Map<string, Entry<unknown>>();
let visibilityBound = false;

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      for (const e of registry.values()) stopTimer(e);
    } else {
      // Resume only entries that still have live subscribers, and
      // refetch immediately so the screen is current on return.
      for (const e of registry.values()) {
        if (e.subs.size > 0) {
          void runFetch(e);
          startTimer(e);
        }
      }
    }
  });
}

function startTimer<T>(e: Entry<T>): void {
  if (e.timer) return;
  // INTENTIONAL: don't start an interval while the tab is hidden — that
  // is the whole point of the visibility-gating. A subscriber that
  // mounts hidden still gets its one initial runFetch (called alongside
  // this in the effect), and the bindVisibility 'visible' handler does
  // the catch-up fetch + starts the interval the instant the tab is
  // looked at. Do NOT remove this guard to "always poll" — that
  // re-introduces the background-polling waste this primitive removes.
  if (typeof document !== "undefined" && document.hidden) return;
  e.timer = setInterval(() => void runFetch(e), e.intervalMs);
}

function stopTimer<T>(e: Entry<T>): void {
  if (e.timer) {
    clearInterval(e.timer);
    e.timer = null;
  }
}

async function runFetch<T>(e: Entry<T>): Promise<void> {
  if (e.inFlight) return; // never overlap a slow request with the next tick
  e.inFlight = true;
  try {
    const v = await e.fetcher();
    e.snap = { value: v, loading: false, error: null };
  } catch (err) {
    e.snap = {
      value: e.snap.value, // keep last good value on a transient failure
      loading: false,
      error: err instanceof Error ? err.message : "error",
    };
  } finally {
    e.inFlight = false;
    for (const notify of e.subs) notify();
  }
}

export function useSharedPoll<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs: number,
): PollSnapshot<T> {
  const [, force] = useState(0);

  useEffect(() => {
    bindVisibility();
    let e = registry.get(key) as Entry<T> | undefined;
    if (!e) {
      e = {
        snap: { value: null, loading: true, error: null },
        fetcher,
        intervalMs,
        subs: new Set(),
        timer: null,
        inFlight: false,
      };
      registry.set(key, e as Entry<unknown>);
    }
    const notify = () => force((n) => (n + 1) % 1_000_000);
    e.subs.add(notify);
    // First subscriber for this key starts the engine; later ones just
    // ride the cached snapshot until the next tick.
    if (e.subs.size === 1) {
      void runFetch(e);
      startTimer(e);
    }
    return () => {
      const cur = registry.get(key) as Entry<T> | undefined;
      if (!cur) return;
      cur.subs.delete(notify);
      // Last subscriber gone → stop polling, but keep the entry + its
      // cached snapshot so a quick remount is instant (and doesn't
      // refetch from scratch).
      if (cur.subs.size === 0) stopTimer(cur);
    };
  }, [key]);

  const e = registry.get(key) as Entry<T> | undefined;
  return e ? e.snap : { value: null, loading: true, error: null };
}
