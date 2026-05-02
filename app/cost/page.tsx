"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./cost.module.css";

/**
 * /cost — astra's spend, in plain language.
 *
 * Four things on this page, in order of attention:
 *   1. Today's spend as the hero number (matches TopBar).
 *   2. A sparkline bar chart of the last N days.
 *   3. Token totals (input/output/cache read/cache creation) — the
 *      story of *why* cost is what it is.
 *   4. Breakdowns by model and by source.
 *
 * No filters beyond the day-window switcher; power users can hit
 * /api/cost?source=chat directly.
 */

type DailyRow = {
  day: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  turns: number;
};

type ModelRow = { model: string; cost_usd: number; turns: number };
type SourceRow = { source: string; cost_usd: number; turns: number };

interface CostResponse {
  window_days: number;
  total_cost_usd: number;
  today_cost_usd: number;
  today_turns: number;
  week_cost_usd: number;
  week_turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms: number;
  turns: number;
  daily: DailyRow[];
  by_model: ModelRow[];
  by_source: SourceRow[];
}

const WINDOWS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

export default function CostPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    fetch(`/api/cost?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as CostResponse;
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
  }, [days]);

  // Pad the daily series so the sparkline shows a continuous N-day
  // timeline even when most days have zero rows.
  const series = useMemo(() => {
    if (!data) return [] as DailyRow[];
    const byDay = new Map(data.daily.map((d) => [d.day, d]));
    const out: DailyRow[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push(
        byDay.get(key) ?? {
          day: key,
          cost_usd: 0,
          input_tokens: 0,
          output_tokens: 0,
          turns: 0,
        },
      );
    }
    return out;
  }, [data, days]);

  const peak = Math.max(0.001, ...series.map((r) => r.cost_usd));
  const avg = data && data.turns > 0 ? data.total_cost_usd / data.turns : 0;

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>cost</span>
        </div>
        <div className={styles.trailRight}>
          {loading && <span>loading…</span>}
          {error && <span className={styles.errText}>error · {error}</span>}
          {!loading && !error && data && (
            <span>
              {data.turns.toLocaleString()} turns · window {data.window_days}d
            </span>
          )}
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          cost · recall · live from the usage ledger
        </div>
        <h1 className={styles.title}>what I&apos;m spending.</h1>
        {data && (
          <p className={styles.summary}>
            <em>{fmtUsd(data.today_cost_usd)}</em> today across{" "}
            <em>{data.today_turns}</em>{" "}
            {data.today_turns === 1 ? "turn" : "turns"}. Week{" "}
            <em>{fmtUsd(data.week_cost_usd)}</em>. Window{" "}
            <em>{fmtUsd(data.total_cost_usd)}</em>. Per turn{" "}
            <em>{fmtUsd(avg, 4)}</em>.
          </p>
        )}
      </section>

      <section className={styles.controls}>
        <div className={styles.windowSwitch} role="tablist">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              role="tab"
              aria-selected={days === w.days}
              className={`${styles.winBtn} ${days === w.days ? styles.winActive : ""}`}
              onClick={() => setDays(w.days)}
              type="button"
            >
              {w.label}
            </button>
          ))}
        </div>
      </section>

      {data && (
        <>
          <section className={styles.chart}>
            <div className={styles.chartHead}>
              <span className={styles.chartLabel}>daily spend</span>
              <span className={styles.chartSub}>peak {fmtUsd(peak)}</span>
            </div>
            <div
              className={styles.bars}
              style={{
                gridTemplateColumns: `repeat(${series.length}, 1fr)`,
              }}
            >
              {series.map((r) => {
                const h = Math.max(2, (r.cost_usd / peak) * 100);
                const empty = r.cost_usd === 0;
                return (
                  <div
                    key={r.day}
                    className={`${styles.bar} ${empty ? styles.barEmpty : ""}`}
                    style={{ height: `${h}%` }}
                    title={`${r.day} · ${fmtUsd(r.cost_usd)} · ${r.turns} turns`}
                    aria-label={`${r.day}: ${fmtUsd(r.cost_usd)}, ${r.turns} turns`}
                  />
                );
              })}
            </div>
            <div className={styles.barsAxis}>
              <span>{series[0]?.day}</span>
              <span>{series[series.length - 1]?.day}</span>
            </div>
          </section>

          <section className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>tokens · window</div>
              <dl className={styles.dl}>
                <dt>input</dt>
                <dd>{fmtNum(data.input_tokens)}</dd>
                <dt>output</dt>
                <dd>{fmtNum(data.output_tokens)}</dd>
                <dt>cache read</dt>
                <dd>{fmtNum(data.cache_read_tokens)}</dd>
                <dt>cache write</dt>
                <dd>{fmtNum(data.cache_creation_tokens)}</dd>
                <dt>duration</dt>
                <dd>{fmtDuration(data.duration_ms)}</dd>
              </dl>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>by model</div>
              {data.by_model.length === 0 && (
                <p className={styles.empty}>no rows in window</p>
              )}
              <dl className={styles.dl}>
                {data.by_model.slice(0, 6).map((m) => (
                  <ModelRow
                    key={m.model}
                    model={m.model}
                    cost_usd={m.cost_usd}
                    turns={m.turns}
                    total={data.total_cost_usd}
                  />
                ))}
              </dl>
            </div>

            <div className={styles.card}>
              <div className={styles.cardLabel}>by source</div>
              {data.by_source.length === 0 && (
                <p className={styles.empty}>no rows in window</p>
              )}
              <dl className={styles.dl}>
                {data.by_source.map((s) => (
                  <ModelRow
                    key={s.source}
                    model={s.source}
                    cost_usd={s.cost_usd}
                    turns={s.turns}
                    total={data.total_cost_usd}
                  />
                ))}
              </dl>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function ModelRow({
  model,
  cost_usd,
  turns,
  total,
}: {
  model: string;
  cost_usd: number;
  turns: number;
  total: number;
}) {
  const pct = total > 0 ? (cost_usd / total) * 100 : 0;
  return (
    <>
      <dt>
        <span className={styles.modelName}>{model || "—"}</span>
        <span className={styles.modelBar}>
          <span
            className={styles.modelBarFill}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </span>
      </dt>
      <dd>
        {fmtUsd(cost_usd)} <span className={styles.tinyDim}>· {turns}</span>
      </dd>
    </>
  );
}

function fmtUsd(n: number, precision = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(precision)}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtDuration(ms: number): string {
  if (!ms) return "0s";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}min`;
  return `${(m / 60).toFixed(1)}h`;
}
