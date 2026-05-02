"use client";

import { useEffect, useRef, useState } from "react";
import { playChime } from "@/lib/chimes";

/**
 * useSignals — derives the canvas's ambient attention state.
 *
 * Polls the same endpoints /today would but returns 0-2 italic
 * whispers + an `alarm` flag. The canvas consumes these and surfaces
 * them as breath, not dashboards. When everything is quiet, this
 * hook returns an empty list and the canvas stays silent.
 *
 * Sources consulted:
 *   - /api/state             — fleet health (degraded or a core agent down)
 *   - /api/cost              — today's spend vs. an (arbitrary) gentle ceiling
 *   - /api/email/unanswered  — real humans awaiting reply (noise-filtered)
 *   - /api/agent/finance     → overdue
 *
 * Rules:
 *   - Crimson alarm only when a core agent is unreachable OR something
 *     is truly urgent (overdue, unpaid).
 *   - At most two whispers on screen.
 */

export interface Signal {
  id: string;
  text: string;
  alarm?: boolean;
  /** Agent id to light up on the canvas, if relevant. */
  agent?: string;
}

const POLL_MS = 60_000;

export function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  // Track which alarm signal ids have already chimed so we don't
  // re-alert every poll while the condition persists.
  const chimedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const [state, cost, email, finance] = await Promise.all([
          safeJson<{
            degraded?: boolean;
            agents?: { id: string; status: string; reachable: boolean }[];
          }>("/api/state"),
          safeJson<{ today_cost_usd?: number; today_turns?: number }>(
            "/api/cost?days=1",
          ),
          // Use the noise-filtered unanswered endpoint — the raw Gmail
          // summary counts every bank alert / vendor pitch as
          // "action_needed", which is why the canvas was whispering
          // "69 emails need a reply" when the real count was 4.
          safeJson<{ count?: number }>("/api/email/unanswered?days=14"),
          safeJson<{
            snapshot?: {
              dashboard?: {
                invoice_summary?: {
                  overdue_amount?: string;
                  overdue_count?: string;
                };
              };
            };
          }>("/api/agent/finance"),
        ]);
        if (cancelled) return;

        const out: Signal[] = [];

        // 1. Core agent down → alarm
        if (state?.agents) {
          const core = new Set(["email", "finance", "whatsapp"]);
          const down = state.agents.filter(
            (a) => core.has(a.id) && !a.reachable,
          );
          for (const a of down.slice(0, 1)) {
            out.push({
              id: `agent-down-${a.id}`,
              text: `${a.id} is unreachable.`,
              alarm: true,
              agent: a.id,
            });
          }
        }

        // 2. Overdue finance → alarm
        const overdue = Number(
          finance?.snapshot?.dashboard?.invoice_summary?.overdue_amount ?? 0,
        );
        const overdueCount = Number(
          finance?.snapshot?.dashboard?.invoice_summary?.overdue_count ?? 0,
        );
        if (overdue > 0 && out.length < 2) {
          out.push({
            id: "finance-overdue",
            text:
              overdueCount === 1
                ? `₹${overdue.toLocaleString()} is overdue.`
                : `₹${overdue.toLocaleString()} overdue across ${overdueCount} invoices.`,
            alarm: true,
            agent: "finance",
          });
        }

        // 3. Unanswered humans → whisper (not alarm)
        // "count" here already excludes noreply/newsletter/bank-alert
        // senders and anything Kunal has replied to since.
        const unanswered = Number(email?.count ?? 0);
        if (unanswered > 0 && out.length < 2) {
          out.push({
            id: "email-unanswered",
            text:
              unanswered === 1
                ? `one person is waiting on you.`
                : `${unanswered} people are waiting on you.`,
            agent: "email",
          });
        }

        // 4. Cost ceiling breached → whisper
        const todayCost = Number(cost?.today_cost_usd ?? 0);
        if (todayCost >= 5 && out.length < 2) {
          out.push({
            id: "cost-high",
            text: `today's spend is $${todayCost.toFixed(2)}.`,
          });
        }

        // Chime once when a new alarm appears. If an alarm goes away
        // we drop its id so a future recurrence re-alerts.
        const currentIds = new Set(out.filter((s) => s.alarm).map((s) => s.id));
        let newAlarm = false;
        for (const id of currentIds) {
          if (!chimedRef.current.has(id)) newAlarm = true;
        }
        for (const id of Array.from(chimedRef.current)) {
          if (!currentIds.has(id)) chimedRef.current.delete(id);
        }
        if (newAlarm) {
          for (const id of currentIds) chimedRef.current.add(id);
          playChime("attention");
        }

        setSignals(out);
      } catch {
        /* silent — ambient layer must not error the canvas */
      }
    }
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return signals;
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
