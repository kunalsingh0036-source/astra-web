"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./audit.module.css";

/**
 * /audit — the trust trail.
 *
 * Every tool Astra has tried to use, with:
 *   - the autonomy mode at the time,
 *   - the permission decision (allow / deny / ask),
 *   - the tier (read / write / communicate / privileged),
 *   - and a short summary of the tool input.
 *
 * The /audit page is explicitly for trust: answers "what did you just
 * do, and why were you allowed to?" Filters by decision and tier narrow
 * the list fast.
 */

interface Item {
  id: number;
  ts: string;
  tool: string;
  tier: string;
  mode: string;
  decision: string;
  summary: string;
  context: string;
}

interface AuditResponse {
  total: number;
  allowed: number;
  denied: number;
  asked: number;
  top_tools: { tool: string; n: number }[];
  items: Item[];
}

const DECISIONS = ["all", "allow", "deny", "ask"] as const;
const TIERS = ["all", "read", "write", "communicate", "privileged"] as const;

type Decision = (typeof DECISIONS)[number];
type Tier = (typeof TIERS)[number];

export default function AuditPage() {
  const [decision, setDecision] = useState<Decision>("all");
  const [tier, setTier] = useState<Tier>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ limit: "200" });
    if (decision !== "all") params.set("decision", decision);
    if (tier !== "all") params.set("tier", tier);
    if (query.trim()) params.set("tool", query.trim());

    fetch(`/api/audit?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AuditResponse;
      })
      .then((body) => {
        if (!aborted) setData(body);
      })
      .catch((e: unknown) => {
        if (!aborted) setError(e instanceof Error ? e.message : "failed to load");
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });

    return () => {
      aborted = true;
    };
  }, [decision, tier, query]);

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>audit</span>
        </div>
        <div className={styles.trailRight}>
          {loading && <span>loading…</span>}
          {error && <span className={styles.errText}>error · {error}</span>}
          {!loading && data && (
            <span>
              {data.total.toLocaleString()} events · {data.items.length} shown
            </span>
          )}
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          audit · trust · every tool, every decision
        </div>
        <h1 className={styles.title}>what I did, and why.</h1>
        {data && data.total > 0 && (
          <p className={styles.summary}>
            <em>{data.allowed}</em> allowed ·{" "}
            <em>{data.denied}</em> denied ·{" "}
            <em>{data.asked}</em> asked.{" "}
            Most used:{" "}
            {data.top_tools.slice(0, 3).map((t, i) => (
              <span key={t.tool}>
                {i > 0 && ", "}
                <em>{t.tool.replace(/^mcp__/, "")}</em> ({t.n})
              </span>
            ))}
            .
          </p>
        )}
        {data && data.total === 0 && (
          <p className={styles.summary}>
            No audit events yet. Astra writes one per tool invocation — use a
            tool from the canvas and they will appear here.
          </p>
        )}
      </section>

      <section className={styles.controls}>
        <div className={styles.searchBar}>
          <span className={styles.searchPrompt}>⌕</span>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter by tool name"
            aria-label="Tool name filter"
          />
        </div>
        <div className={styles.filterRow}>
          <div className={styles.filterGroup} role="tablist" aria-label="Decision">
            {DECISIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={decision === d}
                className={`${styles.filter} ${decision === d ? styles.active : ""}`}
                onClick={() => setDecision(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className={styles.filterGroup} role="tablist" aria-label="Tier">
            {TIERS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tier === t}
                className={`${styles.filter} ${tier === t ? styles.active : ""}`}
                onClick={() => setTier(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.list}>
        {data && data.items.length === 0 && !loading && (
          <p className={styles.empty}>
            {data.total === 0
              ? "No events yet."
              : "No events match these filters."}
          </p>
        )}
        {data?.items.map((e) => (
          <article key={e.id} className={styles.item}>
            <div className={styles.itemTop}>
              <span
                className={`${styles.decision} ${styles[`d_${e.decision}`] ?? ""}`}
              >
                {e.decision}
              </span>
              <span className={styles.tool}>
                {e.tool.replace(/^mcp__/, "")}
              </span>
              <span className={styles.tier}>{e.tier}</span>
              <span className={styles.mode}>{e.mode}</span>
              <span className={styles.time}>{formatTime(e.ts)}</span>
            </div>
            {e.summary && (
              <div className={styles.itemBody}>{e.summary}</div>
            )}
            {e.context && (
              <div className={styles.itemCtx}>{e.context}</div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffS = diffMs / 1000;
  if (diffS < 60) return `${Math.max(1, Math.round(diffS))}s ago`;
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
  return d
    .toLocaleDateString("en-US", { day: "2-digit", month: "short" })
    .toLowerCase();
}
