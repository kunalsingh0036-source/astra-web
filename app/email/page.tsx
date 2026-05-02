"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./email.module.css";

/**
 * /email — Astra's lens on Kunal's Gmail.
 *
 * Not an inbox clone. Two lenses: "Owed" (unanswered humans) and
 * "Today" (last 24h inbound after noise-filter). Both feed the
 * 12:45 IST inbox preview and the 22:00 evening briefing.
 */

interface DigestRow {
  id: string;
  gmail_message_id: string;
  from: string;
  subject: string;
  sent_at: string;
  snippet: string;
  is_read: boolean;
  action_needed: boolean;
  category: string;
  priority: string;
  ai_summary: string;
}

interface UnansweredRow {
  id: string;
  gmail_message_id: string;
  from: string;
  from_email: string;
  subject: string;
  sent_at: string;
  age_hours: number;
  is_read: boolean;
  action_needed: boolean;
  snippet: string;
  category: string;
  priority: string;
  ai_summary: string;
}

interface Digest {
  window_hours: number;
  total_inbound: number;
  real_inbound: number;
  noise_count: number;
  unread: number;
  action_needed: number;
  by_category: Record<string, number>;
  notable: DigestRow[];
}

interface Unanswered {
  days: number;
  count: number;
  rows: UnansweredRow[];
}

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function senderName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1].trim() : addr).slice(0, 42);
}

export default function EmailPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [unans, setUnans] = useState<Unanswered | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"owed" | "today">("owed");

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const [d, u] = await Promise.all([
          fetch("/api/email/digest?hours=24", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/email/unanswered?days=14", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!aborted) {
          if (d.error) setErr(d.error); else setDigest(d);
          if (u.error) setErr((prev) => prev || u.error); else setUnans(u);
        }
      } catch (e) {
        if (!aborted) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { aborted = true; clearInterval(id); };
  }, []);

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>email</span>
        </div>
        <div className={styles.trailRight}>
          {digest ? `${digest.real_inbound} real / ${digest.noise_count} noise` : "…"}
        </div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>email</div>
        <h1 className={styles.title}>what&rsquo;s owed, what&rsquo;s new</h1>
        <div className={styles.sub}>
          Noise filtered. {unans ? unans.count : 0} messages from real humans await reply.
          Preview fires 12:45 IST before your work window.
        </div>
      </header>

      {err ? <div className={styles.err}>{err}</div> : null}

      <div className={styles.tabs}>
        <button
          className={tab === "owed" ? styles.tabActive : styles.tab}
          onClick={() => setTab("owed")}
        >
          owed {unans ? `· ${unans.count}` : ""}
        </button>
        <button
          className={tab === "today" ? styles.tabActive : styles.tab}
          onClick={() => setTab("today")}
        >
          today {digest ? `· ${digest.real_inbound}` : ""}
        </button>
      </div>

      {tab === "owed" ? (
        <section className={styles.list}>
          {!unans ? <div className={styles.hint}>loading…</div> : null}
          {unans && unans.count === 0 ? (
            <div className={styles.empty}>inbox clean. no real humans waiting.</div>
          ) : null}
          {unans?.rows.map((m) => (
            <article
              key={m.id}
              className={m.action_needed ? styles.cardAction : styles.card}
            >
              <div className={styles.cardHead}>
                <span className={styles.cardTime}>{fmtAge(m.age_hours)}</span>
                <span className={styles.cardFrom}>{senderName(m.from)}</span>
                <span className={styles[`cat_${m.category}`] ?? styles.catDefault}>
                  {m.category}
                </span>
                {m.priority && m.priority !== "normal" ? (
                  <span className={styles[`prio_${m.priority}`] ?? styles.catDefault}>
                    {m.priority}
                  </span>
                ) : null}
                {m.action_needed ? <span className={styles.flagAction}>action</span> : null}
                {!m.is_read ? <span className={styles.flagUnread}>unread</span> : null}
              </div>
              <div className={styles.subject}>{m.subject || "(no subject)"}</div>
              {m.ai_summary ? (
                <div className={styles.aiSummary}>— {m.ai_summary}</div>
              ) : m.snippet ? (
                <div className={styles.snippet}>{m.snippet}</div>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <section className={styles.list}>
          {!digest ? <div className={styles.hint}>loading…</div> : null}
          {digest && digest.real_inbound === 0 ? (
            <div className={styles.empty}>quiet last 24h. {digest.noise_count} noise filtered.</div>
          ) : null}
          {digest?.notable.map((m) => (
            <article
              key={m.id}
              className={
                m.action_needed
                  ? styles.cardAction
                  : m.is_read
                    ? styles.cardRead
                    : styles.card
              }
            >
              <div className={styles.cardHead}>
                <span className={styles.cardTime}>{fmtTime(m.sent_at)}</span>
                <span className={styles.cardFrom}>{senderName(m.from)}</span>
                <span className={styles[`cat_${m.category}`] ?? styles.catDefault}>
                  {m.category}
                </span>
                {m.priority && m.priority !== "normal" ? (
                  <span className={styles[`prio_${m.priority}`] ?? styles.catDefault}>
                    {m.priority}
                  </span>
                ) : null}
                {m.action_needed ? <span className={styles.flagAction}>action</span> : null}
                {!m.is_read ? <span className={styles.flagUnread}>unread</span> : null}
              </div>
              <div className={styles.subject}>{m.subject || "(no subject)"}</div>
              {m.ai_summary ? (
                <div className={styles.aiSummary}>— {m.ai_summary}</div>
              ) : m.snippet ? (
                <div className={styles.snippet}>{m.snippet}</div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
