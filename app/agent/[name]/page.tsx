import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { FLEET } from "@/lib/agents";
import type { AgentName } from "@/lib/types";
import { EmailThreadRow } from "@/components/EmailThreadRow";
import { FinanceQuickLog } from "@/components/FinanceQuickLog";
import styles from "./agent.module.css";

/**
 * /agent/[name] — the agent room.
 *
 * Server component that fetches everything in one hop then renders
 * the editorial-spread layout. Each agent gets a tailored room
 * based on what its native API exposes.
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
  // Use the incoming request host so this works in dev without
  // hardcoding localhost.
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

  const data = await getAgentData(agent.id);

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>{agent.label}</span>
        </div>
        <div className={styles.trailRight}>
          <span className={`${styles.statusDot} ${!data?.reachable ? styles.down : ""}`} />
          <span>
            {data?.reachable ? "healthy" : "unreachable"} · :{agent.port}
          </span>
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          agent · {agent.label} · {agent.role}
        </div>
        <h1 className={styles.title}>{agent.label}.</h1>
        {data && <AgentSummary agent={agent.id} data={data} />}
      </section>

      {data && <AgentBody agent={agent.id} data={data} />}
      <AskCard agent={agent.id} />
    </main>
  );
}

/* ─── Ask Astra quick-prompt card ───────────────────────────
   Each room carries three pre-written prompts that are useful when
   you're in that context. Click one and it deep-links into / with
   ?ask=... — the InputLine picks it up and fires immediately. */

const ASK_PROMPTS: Record<string, string[]> = {
  email: [
    "triage my inbox — what needs a reply today?",
    "summarize the last 10 messages in one paragraph",
    "draft a reply to the newest email from a real person",
  ],
  finance: [
    "what invoices are overdue and by how much?",
    "summarize this month's expenses by category",
    "what's my cash runway at current burn?",
  ],
  whatsapp: [
    "which conversations are waiting on me to reply?",
    "list the templates that are approved and ready to send",
    "what is the current 24h session window status?",
  ],
  bookkeeper: [
    "what's the most recent thing the bookkeeper recorded?",
  ],
  linkedin: [
    "what's in the LinkedIn queue right now?",
  ],
  helmtech: [
    "how many HelmTech leads are queued for outbound?",
  ],
  apex: [
    "what's in the Apex outbound queue today?",
  ],
};

function AskCard({ agent }: { agent: AgentName }) {
  const prompts = ASK_PROMPTS[agent] ?? [];
  if (prompts.length === 0) return null;
  return (
    <section className={styles.askCard}>
      <div className={styles.askLabel}>ask astra</div>
      <div className={styles.askPrompts}>
        {prompts.map((p) => (
          <Link
            key={p}
            href={`/?ask=${encodeURIComponent(p)}`}
            className={styles.askPrompt}
          >
            {p}
          </Link>
        ))}
      </div>
    </section>
  );
}

function AgentSummary({ agent, data }: { agent: AgentName; data: AgentPayload }) {
  const snap = data.snapshot as Record<string, unknown>;

  if (!data.reachable) {
    return (
      <p className={styles.summary}>
        Service unreachable right now. I&apos;ll keep polling — the fleet recovers
        itself when it can.
      </p>
    );
  }

  if (agent === "email") {
    const summary = snap.summary as { total?: number; unread?: number; action_needed?: number } | null;
    if (!summary) return null;
    const unread = summary.unread ?? 0;
    const action = summary.action_needed ?? 0;
    return (
      <p className={styles.summary}>
        <em>{unread}</em> unread message{unread === 1 ? "" : "s"}
        {action > 0 ? (
          <>
            . <em>{action}</em> need{action === 1 ? "s" : ""} a reply today.
          </>
        ) : (
          ". Nothing urgent waiting on you."
        )}
      </p>
    );
  }

  if (agent === "finance") {
    const dash = snap.dashboard as Record<string, unknown> | null;
    const invoice = (dash?.invoice_summary ?? null) as Record<string, string> | null;
    const overdue = invoice?.overdue_amount;
    return (
      <p className={styles.summary}>
        {overdue && overdue !== "0" && overdue !== "0.00" ? (
          <>
            <em>₹{overdue}</em> is overdue across{" "}
            <em>{invoice?.overdue_count ?? "—"}</em> invoice
            {invoice?.overdue_count === "1" ? "" : "s"}. Worth a call.
          </>
        ) : (
          <>Books are clean. No overdue invoices.</>
        )}
      </p>
    );
  }

  if (agent === "whatsapp") {
    const stats = snap.stats as { contacts?: number; conversations?: number; messages?: { total?: number } } | null;
    const convos = stats?.conversations ?? 0;
    const msgs = stats?.messages?.total ?? 0;
    return (
      <p className={styles.summary}>
        <em>{convos}</em> conversation{convos === 1 ? "" : "s"} · <em>{msgs}</em>{" "}
        message{msgs === 1 ? "" : "s"} total. Meta gateway is configured.
      </p>
    );
  }

  return null;
}

function AgentBody({ agent, data }: { agent: AgentName; data: AgentPayload }) {
  if (!data.reachable) return null;

  if (agent === "email") {
    const recent = (data.snapshot.recent ?? []) as Array<Record<string, unknown>>;
    // Hero = the most-recent inbound that isn't marked read. Falls back
    // to the newest message of any kind. One big thing, always.
    const hero =
      recent.find(
        (m) =>
          (m.direction as string) === "inbound" &&
          !(m.is_read as boolean | undefined),
      ) ?? recent[0];
    const rest = recent.filter((m) => m !== hero);

    return (
      <>
        {hero && (
          <section className={styles.hero}>
            <div className={styles.heroKicker}>
              the one you should read first
            </div>
            <p className={styles.heroFrom}>{String(hero.from_address ?? "—")}</p>
            <h2 className={styles.heroSubject}>
              {String(hero.subject ?? "(no subject)")}
            </h2>
            {hero.snippet && (
              <p className={styles.heroSnippet}>{String(hero.snippet)}</p>
            )}
            <div className={styles.heroActions}>
              <Link
                href={`/?ask=${encodeURIComponent(
                  `Draft a short reply to this email from ${hero.from_address}: "${hero.subject}". Emit it as a draft artifact.`,
                )}`}
                className={styles.heroAction}
              >
                draft reply →
              </Link>
            </div>
          </section>
        )}

        {rest.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitleQuiet}>the rest</h2>
              <span className={styles.sectionMeta}>
                {rest.length} more · star, archive, or draft a reply
              </span>
            </header>
            <div className={styles.threads}>
              {rest.map((m, i) => (
                <EmailThreadRow
                  key={String(m.id ?? i)}
                  message={{
                    id: String(m.id ?? ""),
                    subject: String(m.subject ?? "(no subject)"),
                    from_address: String(m.from_address ?? "—"),
                    snippet: String(m.snippet ?? ""),
                    direction: String(m.direction ?? "inbound"),
                    is_starred: Boolean(m.is_starred),
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  if (agent === "finance") {
    const dash = (data.snapshot.dashboard ?? {}) as Record<string, Record<string, string>>;
    const invoice = dash.invoice_summary ?? {};
    const expense = dash.expense_summary ?? {};
    const cash = (dash.cash_flow ?? {}) as Record<string, string | null>;
    const invoices = (data.snapshot.invoices ?? []) as Array<Record<string, unknown>>;
    const expenses = (data.snapshot.expenses ?? []) as Array<Record<string, unknown>>;

    const overdueAmount = Number(invoice.overdue_amount ?? 0);
    const overdueCount = Number(invoice.overdue_count ?? 0);
    // Hero: overdue amount if any, else the cash balance.
    const heroIsOverdue = overdueAmount > 0;
    const heroLabel = heroIsOverdue ? "what needs a call today" : "the shape of the books";
    const heroValue = heroIsOverdue
      ? `₹${overdueAmount.toLocaleString()}`
      : `₹${cash.current_balance ?? "0"}`;
    const heroSub = heroIsOverdue
      ? overdueCount === 1
        ? "one invoice past due — ask astra to draft the reminder."
        : `${overdueCount} invoices past due — ask astra to draft the reminders.`
      : "cash balance. nothing past due.";

    return (
      <>
        <section className={`${styles.hero} ${heroIsOverdue ? styles.heroAlarm : ""}`}>
          <div className={styles.heroKicker}>{heroLabel}</div>
          <div className={styles.heroNumber}>{heroValue}</div>
          <p className={styles.heroSnippet}>{heroSub}</p>
          {heroIsOverdue && (
            <div className={styles.heroActions}>
              <Link
                href="/?ask=draft%20reminder%20emails%20for%20every%20overdue%20invoice."
                className={styles.heroAction}
              >
                draft the reminders →
              </Link>
            </div>
          )}
        </section>

        <FinanceQuickLog />

        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitleQuiet}>state of the books</h2>
            <span className={styles.sectionMeta}>from live finance agent</span>
          </header>
          <div className={styles.metrics}>
            <MetricTile label="receivable" value={`₹${invoice.total_receivable ?? "0"}`} />
            <MetricTile label="payable" value={`₹${invoice.total_payable ?? "0"}`} />
            <MetricTile
              label="overdue"
              value={`₹${invoice.overdue_amount ?? "0"}`}
              tone={Number(invoice.overdue_amount ?? 0) > 0 ? "urgent" : "default"}
            />
            <MetricTile label="expenses (30d)" value={`₹${expense.total_amount ?? "0"}`} />
            <MetricTile label="cash balance" value={`₹${cash.current_balance ?? "0"}`} />
          </div>
        </section>

        {invoices.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>recent invoices</h2>
              <span className={styles.sectionMeta}>{invoices.length} shown</span>
            </header>
            <div className={styles.threads}>
              {invoices.map((inv, i) => (
                <article key={i} className={styles.thread}>
                  <div className={styles.threadTop}>
                    <div className={styles.threadFrom}>
                      {String(inv.customer_name ?? inv.customer ?? "—")}
                    </div>
                    <div className={styles.threadTime}>
                      {String(inv.status ?? "—")}
                    </div>
                  </div>
                  <div className={styles.threadSubject}>
                    ₹{String(inv.amount ?? inv.total ?? "0")}
                    {inv.invoice_number && ` · ${String(inv.invoice_number)}`}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {expenses.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>recent expenses</h2>
              <span className={styles.sectionMeta}>{expenses.length} shown</span>
            </header>
            <div className={styles.threads}>
              {expenses.map((ex, i) => (
                <article key={i} className={styles.thread}>
                  <div className={styles.threadTop}>
                    <div className={styles.threadFrom}>
                      {String(ex.vendor ?? ex.description ?? "—")}
                    </div>
                    <div className={styles.threadTime}>
                      {String(ex.category ?? "—")}
                    </div>
                  </div>
                  <div className={styles.threadSubject}>
                    ₹{String(ex.amount ?? "0")}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  if (agent === "whatsapp") {
    const stats = (data.snapshot.stats ?? {}) as Record<string, unknown>;
    const messages = (stats.messages ?? {}) as Record<string, unknown>;
    const templates = (data.snapshot.templates ?? []) as Array<Record<string, unknown>>;
    const convos = (data.snapshot.conversations ?? []) as Array<Record<string, unknown>>;
    const failed = Number(messages.failed ?? 0);
    const heroConvo = convos[0];

    return (
      <>
        {failed > 0 ? (
          <section className={`${styles.hero} ${styles.heroAlarm}`}>
            <div className={styles.heroKicker}>what needs your attention</div>
            <div className={styles.heroNumber}>{failed}</div>
            <p className={styles.heroSnippet}>
              {failed === 1 ? "message" : "messages"} failed to deliver. ask astra to investigate.
            </p>
          </section>
        ) : heroConvo ? (
          <section className={styles.hero}>
            <div className={styles.heroKicker}>most recent conversation</div>
            <p className={styles.heroFrom}>
              {String(heroConvo.contact_name ?? heroConvo.phone ?? "—")}
            </p>
            {heroConvo.last_message ? (
              <h2 className={styles.heroSubject}>
                {String(heroConvo.last_message)}
              </h2>
            ) : (
              <p className={styles.heroSnippet}>no message body captured.</p>
            )}
            <p className={styles.heroSnippet}>
              status · {String(heroConvo.status ?? "active")}
            </p>
          </section>
        ) : (
          <section className={styles.hero}>
            <div className={styles.heroKicker}>quiet on this channel</div>
            <p className={styles.heroSnippet}>
              gateway is live and configured. nothing waiting.
            </p>
          </section>
        )}

        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitleQuiet}>gateway state</h2>
            <span className={styles.sectionMeta}>helm tech · meta configured</span>
          </header>
          <div className={styles.metrics}>
            <MetricTile label="contacts" value={String(stats.contacts ?? 0)} />
            <MetricTile label="conversations" value={String(stats.conversations ?? 0)} />
            <MetricTile label="outbound" value={String(messages.outbound ?? 0)} />
            <MetricTile label="inbound" value={String(messages.inbound ?? 0)} />
            <MetricTile
              label="failed"
              value={String(messages.failed ?? 0)}
              tone={Number(messages.failed ?? 0) > 0 ? "urgent" : "default"}
            />
            <MetricTile label="templates" value={String(templates.length)} />
          </div>
        </section>

        {convos.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>recent conversations</h2>
              <span className={styles.sectionMeta}>{convos.length} shown</span>
            </header>
            <div className={styles.threads}>
              {convos.map((c, i) => (
                <article key={i} className={styles.thread}>
                  <div className={styles.threadTop}>
                    <div className={styles.threadFrom}>
                      {String(c.contact_name ?? c.phone ?? "—")}
                    </div>
                    <div className={styles.threadTime}>
                      {String(c.status ?? "active")}
                    </div>
                  </div>
                  {c.last_message && (
                    <p className={styles.threadPreview}>
                      {String(c.last_message)}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  return null;
}

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "urgent";
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={`${styles.tileValue} ${tone === "urgent" ? styles.tileUrgent : ""}`}>
        {value}
      </div>
    </div>
  );
}
