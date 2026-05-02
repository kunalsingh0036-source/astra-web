"use client";

import Link from "next/link";
import { useMemo } from "react";
import styles from "./Canvas.module.css";
import { RING_RADII } from "@/lib/agents";
import { mergeFleet } from "@/lib/mergeFleet";
import { useFleetState } from "@/lib/useFleetState";
import { useSignals } from "@/lib/useSignals";
import { useChat } from "@/components/ChatProvider";
import type { Agent, AgentStatus } from "@/lib/types";

/**
 * The Canvas — Astra's root view.
 *
 * Orb status blends three signals:
 *   1. Live fleet health (`useFleetState`) — is the service reachable?
 *   2. In-flight tool activity (`useChat`) — is Astra using that agent
 *      right now? If so, pulse brightly.
 *   3. Static orbit parameters from FLEET (ring, period, angle, size).
 *
 * Combining these keeps the canvas aesthetically stable (orbits never
 * shift) while making thinking visible.
 */
export function Canvas() {
  const { state } = useFleetState();
  const { tools } = useChat();
  const signals = useSignals();

  const agents = useMemo(() => {
    const base = mergeFleet(state);

    // Collect the set of agents with a currently-running tool call.
    const running = new Set<string>();
    for (const t of tools) {
      if (t.state === "running" && t.agent) running.add(t.agent);
    }

    // Ambient attention — agents named in an alarm signal burn crimson,
    // agents in a non-alarm signal brighten steadily. This is how the
    // canvas "reveals structure" without a dashboard: the orb itself
    // tells you where to look.
    const attention = new Map<string, "alarm" | "bright">();
    for (const s of signals) {
      if (!s.agent) continue;
      attention.set(s.agent, s.alarm ? "alarm" : "bright");
    }

    if (running.size === 0 && attention.size === 0) return base;

    return base.map((agent) => {
      if (running.has(agent.id)) {
        return { ...agent, status: "pulsing" as AgentStatus };
      }
      const kind = attention.get(agent.id);
      if (kind === "alarm") {
        return { ...agent, status: "alarm" as AgentStatus };
      }
      if (kind === "bright") {
        return { ...agent, status: "active" as AgentStatus };
      }
      return agent;
    });
  }, [state, tools, signals]);

  return (
    <div className={styles.canvas} aria-label="astra fleet canvas">
      {([1, 2, 3] as const).map((r) => (
        <div
          key={r}
          className={`${styles.ring} ${styles[`ring${r}`]}`}
          aria-hidden
        />
      ))}

      <div className={styles.you} aria-label="you" />

      {agents.map((agent) => (
        <Orb key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function Orb({ agent }: { agent: Agent }) {
  const radius = RING_RADII[agent.ring];
  const style: React.CSSProperties & Record<string, string | number> = {
    "--radius": `${radius}px`,
    "--period": `${agent.periodSec}s`,
    "--angle-start": `${agent.angle}deg`,
    "--direction": agent.direction === 1 ? 1 : -1,
    width: `${agent.sizePx}px`,
    height: `${agent.sizePx}px`,
  };

  // Clicking an orb navigates to its agent room. The <Link> renders
  // as an <a> which accepts the same .agent CSS class — the orb still
  // rides its parent .agentWrap orbit animation.
  return (
    <div className={styles.agentWrap} style={style}>
      <Link
        href={`/agent/${agent.id}`}
        className={`${styles.agent} ${styles[statusClass(agent.status)]}`}
        aria-label={`${agent.label} — ${agent.role}`}
        data-name={agent.label}
        prefetch={false}
      />
    </div>
  );
}

function statusClass(status: AgentStatus): "active" | "dim" | "pulsing" | "alarm" | "idle" {
  switch (status) {
    case "pulsing":
      return "pulsing";
    case "active":
      return "active";
    case "dim":
      return "dim";
    case "alarm":
      return "alarm";
    default:
      return "idle";
  }
}
