"use client";

import { useEffect, useRef, useState } from "react";
import type { FleetState } from "./fleet";

/**
 * useFleetState — client-side hook that polls /api/state.
 *
 * Behavior:
 *   - Fetches immediately on mount.
 *   - Re-polls every 10s.
 *   - Exposes `state`, `loading`, `error`, `lastUpdated`.
 *   - Cleans up on unmount (no zombie intervals on route change).
 *
 * We deliberately don't use SWR/Tanstack here — it's one endpoint,
 * no cache-keying, and keeping the dep tree small matters.
 */

const POLL_MS = 10_000;

export function useFleetState() {
  const [state, setState] = useState<FleetState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchOnce() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as FleetState;
        if (mountedRef.current) {
          setState(body);
          setError(null);
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "unknown error");
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, []);

  return { state, loading, error };
}
