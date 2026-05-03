import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { FLEET } from "@/lib/agents";
import type { AgentName } from "@/lib/types";
import { ActivityFeed } from "@/components/AgentRoom/ActivityFeed";
import { ActionPanel } from "@/components/AgentRoom/ActionPanel";
import { AgentSnapshot } from "@/components/AgentRoom/AgentSnapshot";
import { AGENT_ACTIONS } from "@/components/AgentRoom/agentActions";
import { FinanceQuickLog } from "@/components/FinanceQuickLog";
import styles from "./agent.module.css";

/**
 * /agent/[name] — the agent room.
 *
 * Server component fetches an initial snapshot for first-paint, then
 * hands off to client components that poll for live updates:
 *
 *   - <AgentSnapshot />  — agent-specific live data (10s poll)
 *   - <ActivityFeed />   — recent tool calls + running turns (4s poll)
 *   - <ActionPanel />    — explicit per-agent actions, no generic prompts
 *
 * The room is interactive at the agent level: actions either fire
 * structured Astra prompts (with full context, no follow-up needed)
 * or open in-room forms (FinanceQuickLog, etc.). The boring
 * "ask astra" 3-prompt card has been replaced.
 */

interface Props {
  params: Promise<{ name: string }>;
}

interface AgentPayload {
  agent: AgentName;
  reachable: boolean;
  health: Record<string, unknown> | null;
  snapshot: Record<string, unknown>;
  probedAt: string;
}

async function getAgentData(name: AgentName): Promise<AgentPayload | null> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const res = await fetch(`${proto}://${host}/api/agent/${name}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as AgentPayload;
}

export default async function AgentPage({ params }: Props) {
  const { name } = await params;
  const agent = FLEET.find((a) => a.id === name);
  if (!agent) notFound();

  const initial = await getAgentData(agent.id);
  const groups = AGENT_ACTIONS[agent.id] ?? [];

  // Custom in-room slots — keyed components that ActionPanel renders
  // inline when the user clicks an action with kind="custom". This is
  // how the room can host real forms (expense quick-log, etc.) without
  // needing a deep-link to a different page.
  const customSlots: Record<string, React.ReactNode> = {
    "finance-quick-log": <FinanceQuickLog />,
  };

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>{agent.label}</span>
        </div>
        <div className={styles.trailRight}>
          <span
            className={`${styles.statusDot} ${
              !initial?.reachable ? styles.down : ""
            }`}
          />
          <span>
            {initial?.reachable ? "healthy" : "unreachable"} · :{agent.port}
          </span>
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          agent · {agent.label} · {agent.role}
        </div>
        <h1 className={styles.title}>{agent.label}.</h1>
      </section>

      <div className={styles.body}>
        {/* Live snapshot — agent-specific layout, polls /api/agent/[name] */}
        <AgentSnapshot agent={agent.id} initial={initial} />

        {/* Live activity feed — what astra is doing with this agent right now */}
        <ActivityFeed agent={agent.id} />

        {/* Curated actions — explicit, contextual, replaces the old 3-prompt card */}
        {groups.length > 0 && (
          <ActionPanel
            agent={agent.id}
            groups={groups}
            customSlots={customSlots}
          />
        )}
      </div>
    </main>
  );
}
