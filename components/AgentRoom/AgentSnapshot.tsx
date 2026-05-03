"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./AgentSnapshot.module.css";
import { EmailThreadRow } from "@/components/EmailThreadRow";
import type { AgentName } from "@/lib/types";

/**
 * Client-side snapshot for an agent room.
 *
 * Polls /api/agent/[name] every 10s so the room reflects live data
 * without a manual refresh. Renders agent-specific layouts:
 *
 *   - email      → hero "the one to read first" + thread list
 *   - finance    → overdue hero + KPI tiles + invoices/expenses
 *   - whatsapp   → conversation hero + gateway tiles + recent threads
 *   - others     → a generic "service is healthy" panel + nothing more
 *                  (each empty room still has its own ActivityFeed +
 *                   ActionPanel rendered above this — so it's never
 *                   blank, just snapshot-light)
 */

interface AgentPayload {
  agent: AgentName;
  reachable: boolean;
  health: Record<string, unknown> | null;
  snapshot: Record<string, unknown>;
  probedAt: string;
}

const POLL_MS = 10_000;

interface Props {
  agent: AgentName;
  initial: AgentPayload | null;
}

export function AgentSnapshot({ agent, initial }: Props) {
  const [data, setData] = useState<AgentPayload | null>(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/agent/${agent}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as AgentPayload;
          setData(json);
        }
      } catch {
        /* swallow */
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agent]);

  if (!data) {
    return (
      <section className={styles.panel}>
        <p className={styles.empty}>connecting to agent…</p>
      </section>
    );
  }

  if (!data.reachable) {
    return (
      <section className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.tagAlarm}>service unreachable</span>
        </header>
        <p className={styles.empty}>
          can&apos;t reach this agent right now. astra will keep trying — actions still
          work, they&apos;ll fire once the service is back.
        </p>
      </section>
    );
  }

  return <Body agent={agent} data={data} />;
}

function Body({ agent, data }: { agent: AgentName; data: AgentPayload }) {
  if (agent === "email") return <EmailBody data={data} />;
  if (agent === "finance") return <FinanceBody data={data} />;
  if (agent === "whatsapp") return <WhatsAppBody data={data} />;
  return <GenericHealthBody data={data} />;
}

function EmailBody({ data }: { data: AgentPayload }) {
  const summary = data.snapshot.summary as
    | { total?: number; unread?: number; action_needed?: number }
    | null;
  const recent = (data.snapshot.recent ?? []) as Array<Record<string, unknown>>;
  const hero =
    recent.find(
      (m) =>
        (m.direction as string) === "inbound" &&
        !(m.is_read as boolean | undefined),
    ) ?? recent[0];
  const rest = recent.filter((m) => m !== hero);

  return (
    <>
      <section className={styles.summary}>
        <p className={styles.summaryText}>
          <em>{summary?.unread ?? 0}</em> unread
          {(summary?.action_needed ?? 0) > 0 ? (
            <>
              {" "}
              · <em>{summary?.action_needed}</em> need
              {summary?.action_needed === 1 ? "s" : ""} a reply today
            </>
          ) : (
            <> · nothing urgent</>
          )}
        </p>
      </section>

      {hero && (
        <section className={styles.hero}>
          <div className={styles.heroKicker}>the one you should read first</div>
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
            <h3 className={styles.sectionTitleQuiet}>the rest</h3>
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

function FinanceBody({ data }: { data: AgentPayload }) {
  const dash = (data.snapshot.dashboard ?? {}) as Record<
    string,
    Record<string, string>
  >;
  const invoice = dash.invoice_summary ?? {};
  const expense = dash.expense_summary ?? {};
  const cash = (dash.cash_flow ?? {}) as Record<string, string | null>;
  const invoices = (data.snapshot.invoices ?? []) as Array<
    Record<string, unknown>
  >;
  const expenses = (data.snapshot.expenses ?? []) as Array<
    Record<string, unknown>
  >;

  const overdueAmount = Number(invoice.overdue_amount ?? 0);
  const overdueCount = Number(invoice.overdue_count ?? 0);
  const heroIsOverdue = overdueAmount > 0;
  const heroLabel = heroIsOverdue
    ? "what needs a call today"
    : "the shape of the books";
  const heroValue = heroIsOverdue
    ? `₹${overdueAmount.toLocaleString()}`
    : `₹${cash.current_balance ?? "0"}`;
  const heroSub = heroIsOverdue
    ? overdueCount === 1
      ? "one invoice past due — fire 'draft reminders' below."
      : `${overdueCount} invoices past due — fire 'draft reminders' below.`
    : "cash balance. nothing past due.";

  return (
    <>
      <section
        className={`${styles.hero} ${heroIsOverdue ? styles.heroAlarm : ""}`}
      >
        <div className={styles.heroKicker}>{heroLabel}</div>
        <div className={styles.heroNumber}>{heroValue}</div>
        <p className={styles.heroSnippet}>{heroSub}</p>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h3 className={styles.sectionTitleQuiet}>state of the books</h3>
          <span className={styles.sectionMeta}>from live finance agent</span>
        </header>
        <div className={styles.metrics}>
          <MetricTile
            label="receivable"
            value={`₹${invoice.total_receivable ?? "0"}`}
          />
          <MetricTile
            label="payable"
            value={`₹${invoice.total_payable ?? "0"}`}
          />
          <MetricTile
            label="overdue"
            value={`₹${invoice.overdue_amount ?? "0"}`}
            tone={heroIsOverdue ? "urgent" : "default"}
          />
          <MetricTile
            label="expenses (30d)"
            value={`₹${expense.total_amount ?? "0"}`}
          />
          <MetricTile
            label="cash balance"
            value={`₹${cash.current_balance ?? "0"}`}
          />
        </div>
      </section>

      {invoices.length > 0 && (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>recent invoices</h3>
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
            <h3 className={styles.sectionTitle}>recent expenses</h3>
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

function WhatsAppBody({ data }: { data: AgentPayload }) {
  const stats = (data.snapshot.stats ?? {}) as Record<string, unknown>;
  const messages = (stats.messages ?? {}) as Record<string, unknown>;
  const templates = (data.snapshot.templates ?? []) as Array<
    Record<string, unknown>
  >;
  const convos = (data.snapshot.conversations ?? []) as Array<
    Record<string, unknown>
  >;
  const failed = Number(messages.failed ?? 0);
  const heroConvo = convos[0];

  return (
    <>
      {failed > 0 ? (
        <section className={`${styles.hero} ${styles.heroAlarm}`}>
          <div className={styles.heroKicker}>what needs your attention</div>
          <div className={styles.heroNumber}>{failed}</div>
          <p className={styles.heroSnippet}>
            {failed === 1 ? "message" : "messages"} failed to deliver. ask astra
            to investigate.
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
          <h3 className={styles.sectionTitleQuiet}>gateway state</h3>
          <span className={styles.sectionMeta}>helm tech · meta configured</span>
        </header>
        <div className={styles.metrics}>
          <MetricTile label="contacts" value={String(stats.contacts ?? 0)} />
          <MetricTile
            label="conversations"
            value={String(stats.conversations ?? 0)}
          />
          <MetricTile label="outbound" value={String(messages.outbound ?? 0)} />
          <MetricTile label="inbound" value={String(messages.inbound ?? 0)} />
          <MetricTile
            label="failed"
            value={String(messages.failed ?? 0)}
            tone={failed > 0 ? "urgent" : "default"}
          />
          <MetricTile label="templates" value={String(templates.length)} />
        </div>
      </section>

      {convos.length > 0 && (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>recent conversations</h3>
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

function GenericHealthBody({ data }: { data: AgentPayload }) {
  // For agents whose service doesn't expose a custom snapshot endpoint
  // (bookkeeper, linkedin, helmtech, apex right now), we render a small
  // "service is healthy" card. The real value of the room comes from
  // the ActivityFeed + ActionPanel rendered alongside.
  const probed = new Date(data.probedAt);
  const probedLabel = probed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.tagOk}>service healthy</span>
        <span className={styles.headMeta}>last probed {probedLabel}</span>
      </header>
      <p className={styles.healthBody}>
        this agent doesn&apos;t expose a structured snapshot yet. use the actions
        below to ask astra for a status report — the result will show up in
        chat and the activity feed will log the call.
      </p>
    </section>
  );
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
      <div
        className={`${styles.tileValue} ${
          tone === "urgent" ? styles.tileUrgent : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
