"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./today.module.css";

/**
 * /today — the single-view dashboard.
 *
 * Composes the most important signals from the rest of the app into
 * one readable page: today's spend, fleet status, unread emails,
 * overdue invoices, pending WhatsApp replies, most recent briefing,
 * and the latest audit decisions.
 *
 * Nothing here is authoritative — every card links out to its source
 * page for the full story.
 */

interface CostSnap {
  today_cost_usd: number;
  today_turns: number;
  week_cost_usd: number;
  total_cost_usd: number;
}

interface AgentHealth {
  id: string;
  status: string;
  reachable: boolean;
}

interface FleetSnap {
  agents: AgentHealth[];
  degraded: boolean;
}

interface AuditSnap {
  allowed: number;
  denied: number;
  asked: number;
  top_tools: { tool: string; n: number }[];
}

interface EmailSummary {
  total?: number;
  unread?: number;
  action_needed?: number;
}

interface BriefingSnap {
  current: { content: string; created_at: string } | null;
}

export default function TodayPage() {
  const [cost, setCost] = useState<CostSnap | null>(null);
  const [fleet, setFleet] = useState<FleetSnap | null>(null);
  const [audit, setAudit] = useState<AuditSnap | null>(null);
  const [email, setEmail] = useState<EmailSummary | null>(null);
  const [finance, setFinance] = useState<Record<string, string> | null>(null);
  const [whatsapp, setWhatsapp] = useState<Record<string, unknown> | null>(null);
  const [briefing, setBriefing] = useState<BriefingSnap | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      const [c, s, a, em, fi, wa, br] = await Promise.all([
        fetch("/api/cost?days=30", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/state", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/audit?limit=1", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/agent/email", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/agent/finance", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/agent/whatsapp", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/briefing?limit=1", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (cancelled) return;
      setCost(c);
      setFleet(s);
      setAudit(a);
      setEmail(em?.snapshot?.summary ?? null);
      setFinance(fi?.snapshot?.dashboard?.invoice_summary ?? null);
      setWhatsapp(wa?.snapshot?.stats ?? null);
      setBriefing(br);
    }
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const now = new Date();
  const greeting = greetingFor(now);

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>today</span>
        </div>
        <div className={styles.trailRight}>
          <span>{now.toLocaleString("en-US", { weekday: "short", day: "2-digit", month: "short" }).toLowerCase()}</span>
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>today · a single view</div>
        <h1 className={styles.title}>{greeting}.</h1>
        <p className={styles.summary}>
          Everything worth glancing at — {" "}
          {cost ? <em>{fmtUsd(cost.today_cost_usd)}</em> : <em>—</em>}{" "}
          spent today, {" "}
          {fleet ? <em>{fleet.agents.filter((a) => a.reachable).length}/{fleet.agents.length}</em> : <em>—</em>}{" "}
          agents nominal, {" "}
          {email?.unread !== undefined ? <em>{email.unread}</em> : <em>—</em>} unread.
        </p>
      </section>

      <section className={styles.grid}>
        {/* Cost tile */}
        <Link href="/cost" className={styles.card}>
          <div className={styles.cardLabel}>cost · today</div>
          <div className={styles.cardValue}>
            {cost ? fmtUsd(cost.today_cost_usd) : "—"}
          </div>
          <div className={styles.cardSub}>
            {cost ? (
              <>
                {cost.today_turns} {cost.today_turns === 1 ? "turn" : "turns"} ·{" "}
                week {fmtUsd(cost.week_cost_usd)}
              </>
            ) : (
              "loading…"
            )}
          </div>
        </Link>

        {/* Fleet tile */}
        <Link href="/" className={styles.card}>
          <div className={styles.cardLabel}>fleet</div>
          <div
            className={`${styles.cardValue} ${fleet?.degraded ? styles.urgent : ""}`}
          >
            {fleet
              ? `${fleet.agents.filter((a) => a.reachable).length}/${fleet.agents.length}`
              : "—"}
          </div>
          <div className={styles.cardSub}>
            {fleet?.degraded ? "degraded · core agent down" : "nominal · all core up"}
          </div>
        </Link>

        {/* Email tile */}
        <Link href="/agent/email" className={styles.card}>
          <div className={styles.cardLabel}>email · inbox</div>
          <div
            className={`${styles.cardValue} ${(email?.action_needed ?? 0) > 0 ? styles.urgent : ""}`}
          >
            {email?.unread ?? "—"}
          </div>
          <div className={styles.cardSub}>
            {email?.action_needed
              ? `${email.action_needed} need a reply`
              : "nothing urgent"}
          </div>
        </Link>

        {/* Finance tile */}
        <Link href="/agent/finance" className={styles.card}>
          <div className={styles.cardLabel}>finance · overdue</div>
          <div
            className={`${styles.cardValue} ${
              Number(finance?.overdue_amount ?? 0) > 0 ? styles.urgent : ""
            }`}
          >
            {finance ? `₹${finance.overdue_amount ?? "0"}` : "—"}
          </div>
          <div className={styles.cardSub}>
            {finance?.overdue_count
              ? `${finance.overdue_count} invoice${finance.overdue_count === "1" ? "" : "s"}`
              : "books clean"}
          </div>
        </Link>

        {/* WhatsApp tile */}
        <Link href="/agent/whatsapp" className={styles.card}>
          <div className={styles.cardLabel}>whatsapp</div>
          <div className={styles.cardValue}>
            {whatsapp ? String(whatsapp.conversations ?? 0) : "—"}
          </div>
          <div className={styles.cardSub}>
            {whatsapp ? `${whatsapp.contacts ?? 0} contacts · gateway live` : "loading…"}
          </div>
        </Link>

        {/* Audit tile */}
        <Link href="/audit" className={styles.card}>
          <div className={styles.cardLabel}>audit · trail</div>
          <div className={styles.cardValue}>
            {audit ? audit.allowed + audit.denied + audit.asked : "—"}
          </div>
          <div className={styles.cardSub}>
            {audit ? (
              <>
                {audit.allowed} allow · {audit.denied} deny · {audit.asked} ask
              </>
            ) : (
              "loading…"
            )}
          </div>
        </Link>
      </section>

      {/* Briefing snippet */}
      <section className={styles.brief}>
        <div className={styles.briefHead}>
          <span className={styles.cardLabel}>latest briefing</span>
          <Link href="/briefing" className={styles.briefMore}>
            read in full →
          </Link>
        </div>
        {briefing?.current ? (
          <pre className={styles.briefBody}>
            {briefing.current.content.split("\n").slice(0, 8).join("\n")}
            {briefing.current.content.split("\n").length > 8 ? "\n…" : ""}
          </pre>
        ) : (
          <p className={styles.empty}>
            no briefing yet. type <em>morning briefing</em> on the canvas to fire
            one on demand.
          </p>
        )}
      </section>
    </main>
  );
}

function fmtUsd(n: number, precision = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(precision)}`;
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "the late hours";
  if (h < 12) return "good morning";
  if (h < 18) return "good afternoon";
  return "good evening";
}
