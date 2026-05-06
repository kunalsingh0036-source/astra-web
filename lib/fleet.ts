/**
 * Server-side fleet health probe.
 *
 * Used by /api/state to fetch live status from every agent in parallel.
 * Each probe is isolated — one agent going down never blocks the others.
 * Timeouts are aggressive (1.5s) so a stuck agent doesn't stall the poll.
 */

import type { AgentName, AgentStatus } from "./types";
import { urlForAgent } from "./agentUrls";

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

/** Service URL for each agent — delegates to lib/agentUrls so all
 *  routing logic shares one resolver (public-tunnel default for
 *  email/whatsapp; null/empty for agents whose URL isn't set). */
function urlFor(agent: AgentName): string {
  return urlForAgent(agent) ?? "";
}

/**
 * Probe an agent for liveness. Tolerant of three real-world drifts:
 *
 *   1. Path convention: FastAPI agents (email, finance, whatsapp)
 *      expose /health; Next.js dashboards (linkedin) expose
 *      /api/health. Try /health first, fall back to /api/health.
 *
 *   2. Status string: backends use "healthy"; some apps return
 *      "ok"; some return nothing structured. Accept both. Treat
 *      a successful HTTP 200 with parseable JSON as reachable
 *      regardless of status string — the dashboard agents that
 *      respond at all are alive.
 *
 *   3. HTML responses (Next.js catch-all routes returning 200
 *      HTML for unknown paths): the JSON parse fails, we don't
 *      crash, treat as unreachable. This is the right answer —
 *      a frontend without a real health endpoint shouldn't
 *      claim active.
 */
async function probeAgent(agent: AgentName, signal: AbortSignal): Promise<AgentHealth> {
  const url = urlFor(agent);
  const probedAt = new Date().toISOString();

  if (!url) {
    return { id: agent, status: "dim", reachable: false, probedAt };
  }

  // Try the canonical /health first, then /api/health for Next.js-
  // routed agents. The first one that returns 200 + parseable JSON
  // wins; if both fail, the agent is dim.
  for (const path of ["/health", "/api/health"]) {
    try {
      const res = await fetch(`${url}${path}`, {
        signal,
        cache: "no-store",
      });
      if (!res.ok) continue;
      // Parse JSON; if the route returns HTML (catch-all), this
      // throws and we treat the path as not-a-real-health-endpoint.
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        continue;
      }
      const status = body.status;
      // Accept "healthy", "ok", or any truthy string + 200 status.
      // The fastapi convention is "healthy"; nextjs convention is
      // "ok"; some agents just return {ok: true}. All count.
      const healthy =
        status === "healthy" ||
        status === "ok" ||
        body.ok === true ||
        (typeof status === "string" && status.length > 0);
      return {
        id: agent,
        status: healthy ? "active" : "dim",
        reachable: true,
        raw: body,
        probedAt,
      };
    } catch {
      // network error / timeout — try next path, then give up
    }
  }
  return { id: agent, status: "dim", reachable: false, probedAt };
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
