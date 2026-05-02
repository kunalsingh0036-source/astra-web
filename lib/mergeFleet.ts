import { FLEET } from "./agents";
import type { AgentHealth, FleetState } from "./fleet";
import type { Agent, AgentStatus } from "./types";

/**
 * Merge static orbit parameters (from lib/agents.ts) with live health
 * (from /api/state) into the Agent[] shape the Canvas consumes.
 *
 * Rule: the mock fleet always defines orbit physics. Live state only
 * overrides `status`. This keeps the canvas aesthetically stable even
 * when the fleet is partially unreachable.
 */
export function mergeFleet(state: FleetState | null): Agent[] {
  if (!state) return FLEET;

  const byId = new Map<string, AgentHealth>();
  for (const a of state.agents) byId.set(a.id, a);

  return FLEET.map((agent) => {
    const live = byId.get(agent.id);
    if (!live) return agent;

    // Live status wins — except when an agent in the mock fleet was
    // specifically set to "pulsing" (denoting active work), we preserve
    // the pulsing state so the canvas shows when Astra is busy on
    // behalf of that agent. In Phase 3 this becomes stream-driven.
    const status: AgentStatus = live.reachable
      ? agent.status === "pulsing"
        ? "pulsing"
        : "active"
      : "dim";

    return { ...agent, status };
  });
}
