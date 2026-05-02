/**
 * Server-side fleet health probe.
 *
 * Used by /api/state to fetch live status from every agent in parallel.
 * Each probe is isolated — one agent going down never blocks the others.
 * Timeouts are aggressive (1.5s) so a stuck agent doesn't stall the poll.
 */

import type { AgentName, AgentStatus } from "./types";

export interface AgentHealth {
  id: AgentName;
  /** Current status derived from the health response + activity. */
  status: AgentStatus;
  /** Liveness — did the service respond at all? */
  reachable: boolean;
  /** Raw last-seen payload, for debugging + ops-mode detail views. */
  raw?: Record<string, unknown>;
  /** ISO timestamp of the probe. */
  probedAt: string;
}

export interface FleetState {
  agents: AgentHealth[];
  bridge: {
    reachable: boolean;
    agentsRegistered: number;
  };
  /** Everything completed at the same instant, UTC. */
  probedAt: string;
  /** True when any upstream probe fell back to cached/mock state. */
  degraded: boolean;
}

/** Service URL for each agent. Read from env at request time. */
function urlFor(agent: AgentName): string {
  const byAgent: Record<AgentName, string | undefined> = {
    email: process.env.EMAIL_URL,
    finance: process.env.FINANCE_URL,
    whatsapp: process.env.WHATSAPP_URL,
    bookkeeper: process.env.BOOKKEEPER_URL,
    linkedin: process.env.LINKEDIN_URL,
    helmtech: process.env.HELMTECH_URL,
    apex: process.env.APEX_URL,
  };
  return byAgent[agent] ?? "";
}

async function probeAgent(agent: AgentName, signal: AbortSignal): Promise<AgentHealth> {
  const url = urlFor(agent);
  const probedAt = new Date().toISOString();

  if (!url) {
    return { id: agent, status: "dim", reachable: false, probedAt };
  }

  try {
    const res = await fetch(`${url}/health`, {
      signal,
      cache: "no-store",
      // Server-side fetch — no CORS concerns.
    });
    if (!res.ok) {
      return { id: agent, status: "dim", reachable: false, probedAt };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const status = body.status;
    const healthy = status === "healthy";
    return {
      id: agent,
      status: healthy ? "active" : "dim",
      reachable: true,
      raw: body,
      probedAt,
    };
  } catch {
    return { id: agent, status: "dim", reachable: false, probedAt };
  }
}

async function probeBridge(signal: AbortSignal) {
  const bridgeUrl = process.env.ASTRA_BRIDGE_URL;
  if (!bridgeUrl) return { reachable: false, agentsRegistered: 0 };

  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal, cache: "no-store" });
    if (!res.ok) return { reachable: false, agentsRegistered: 0 };
    const body = (await res.json()) as { agents?: string[] };
    return {
      reachable: true,
      agentsRegistered: body.agents?.length ?? 0,
    };
  } catch {
    return { reachable: false, agentsRegistered: 0 };
  }
}

/**
 * Core agents — launched by `astra up` and required for a nominal
 * fleet. If any of these is unreachable we flip to "degraded".
 */
const CORE_AGENTS: readonly AgentName[] = ["email", "finance", "whatsapp"];

/**
 * Optional agents — standalone projects (bookkeeper, linkedin) or
 * remote-deployed partners (helmtech, apex). They show up on the
 * canvas as "dim" when unreachable but don't flip the whole fleet to
 * degraded. When their URL env isn't set we simply don't probe them.
 */
const OPTIONAL_AGENTS: readonly AgentName[] = [
  "bookkeeper",
  "linkedin",
  "helmtech",
  "apex",
];

/**
 * Probe the entire fleet. Returns quickly — each probe has its own
 * timeout, results collected in parallel.
 */
export async function probeFleet(): Promise<FleetState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    // Only probe optional agents that have a URL configured. No URL
    // means "we aren't trying to reach this one" — not a failure.
    const optionalToProbe = OPTIONAL_AGENTS.filter((a) => urlFor(a));
    const allAgents = [...CORE_AGENTS, ...optionalToProbe];

    const [agentResults, bridge] = await Promise.all([
      Promise.all(allAgents.map((a) => probeAgent(a, controller.signal))),
      probeBridge(controller.signal),
    ]);

    // Degraded only if the bridge is down OR a CORE agent is down.
    // Optional agents being dim is expected state, not a problem.
    const coreSet = new Set<AgentName>(CORE_AGENTS);
    const degraded =
      !bridge.reachable ||
      agentResults.some((a) => coreSet.has(a.id) && !a.reachable);

    return {
      agents: agentResults,
      bridge,
      probedAt: new Date().toISOString(),
      degraded,
    };
  } finally {
    clearTimeout(timeout);
  }
}
