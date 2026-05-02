"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { playChime } from "@/lib/chimes";
import styles from "./briefing.module.css";

/**
 * /briefing — monastic-mode morning briefing.
 *
 * Renders the most recent episodic briefing memory (written by the
 * scheduler `morning_briefing` job). If no briefing exists yet, the
 * user can fire one on-demand via the canvas — typing "morning
 * briefing" sends the trigger_briefing tool.
 */

interface BriefingRow {
  id: number;
  content: string;
  created_at: string;
  importance: number;
  tags: string | null;
}

interface BriefingResponse {
  current: BriefingRow | null;
  history: BriefingRow[];
  message?: string;
}

export default function BriefingPage() {
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chimedRef = useRef(false);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    fetch("/api/briefing?limit=7", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as BriefingResponse;
      })
      .then((body) => {
        if (aborted) return;
        setData(body);
        // Briefing-landed chime — fires once when the page first shows
        // a real briefing. Respects the user's sound toggle.
        if (!chimedRef.current && body.current) {
          chimedRef.current = true;
          playChime("briefing");
        }
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
  }, []);

  const current = data?.current;
  // Split the text content into paragraphs on blank lines for a more
  // monastic rhythm. Every paragraph gets its own block; consecutive
  // "bulleted" lines cluster into a single body.
  const paragraphs = useMemo(
    () => splitParagraphs(current?.content ?? ""),
    [current?.content],
  );

  const when = current ? formatWhen(current.created_at) : null;

  return (
    <main className={styles.main}>
      <div className={styles.mode}>
        mode · <b>monastic</b>
      </div>

      <header className={styles.opener}>
        <h1 className={styles.greet}>
          good
          <br />
          <em>{greeting()},</em>
          <br />
          kunal.
        </h1>
        <p className={styles.openerSub}>
          {loading && <em>fetching the briefing…</em>}
          {error && (
            <span style={{ color: "var(--alarm)" }}>error · {error}</span>
          )}
          {!loading && !error && current && (
            <>
              your last briefing landed{" "}
              <em>{when}</em>. read in a sip.
            </>
          )}
          {!loading && !error && !current && (
            <>
              {data?.message ??
                "no briefings yet. type “morning briefing” on the canvas to fire one."}
            </>
          )}
        </p>
      </header>

      <div className={styles.meta}>
        <div className={styles.metaLabel}>
          {current ? (
            <>
              morning briefing · <b>{formatDayTime(current.created_at)}</b>
            </>
          ) : (
            <>morning briefing · <b>no history yet</b></>
          )}
        </div>
        <div className={styles.metaDate}>{formatWordDate(new Date())}</div>
      </div>

      {current && (
        <section className={styles.brief}>
          {paragraphs.map((para, i) => (
            <article key={i} className={styles.item}>
              {i === 0 && (
                <div className={styles.kicker}>
                  01 · {isoDay(current.created_at)}
                </div>
              )}
              <div className={styles.body}>
                {para.split("\n").map((line, li) => (
                  <p key={li}>{line}</p>
                ))}
              </div>
            </article>
          ))}

          <div className={styles.end}>
            <div className={styles.endMark}>end of brief</div>
            <div className={styles.endLine} />
          </div>
        </section>
      )}

      {!current && !loading && (
        <section className={styles.brief}>
          <article className={styles.item}>
            <div className={styles.body}>
              <p>
                Run <em>morning briefing</em> from the canvas. The scheduler
                also fires this at 07:30 local each day and writes the output
                into memory where this page reads from.
              </p>
              <p>
                <Link href="/?ask=run%20my%20morning%20briefing">
                  ask astra to run one now →
                </Link>
              </p>
            </div>
          </article>
        </section>
      )}

      {data && data.history.length > 0 && (
        <section className={styles.history}>
          <div className={styles.historyLabel}>history · older briefings</div>
          {data.history.map((h) => (
            <article key={h.id} className={styles.historyItem}>
              <div className={styles.historyTop}>
                <span className={styles.historyDate}>
                  {formatWordDate(new Date(h.created_at))}
                </span>
                <span className={styles.historyWhen}>{formatWhen(h.created_at)}</span>
              </div>
              <pre className={styles.historyBody}>{h.content}</pre>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

/* ─── helpers ─────────────────────────────────────────── */

function splitParagraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "evening";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = diffMin / 60;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "yesterday";
  return `${diffD}d ago`;
}

function formatDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d
    .toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" })
    .toLowerCase();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${day} · ${time}`;
}

function isoDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatWordDate(d: Date): string {
  const month = d.toLocaleDateString("en-US", { month: "long" }).toLowerCase();
  const year = d.getFullYear();
  const words = numberToWords(year);
  return `${month}, the year ${words}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function numberToWords(n: number): string {
  // e.g. 2026 → "twenty twenty-six". Enough for 2000-2099.
  if (n >= 2000 && n < 2100) {
    const rest = n - 2000;
    if (rest === 0) return "two thousand";
    if (rest < 10) return `two thousand ${ones(rest)}`;
    if (rest < 20) return `twenty ${teens(rest - 10)}`;
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    return units === 0
      ? `twenty ${tensWord(tens)}`
      : `twenty ${tensWord(tens)}-${ones(units)}`;
  }
  return String(n);
}

function ones(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n];
}
function teens(n: number): string {
  return ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"][n];
}
function tensWord(n: number): string {
  return ["", "ten", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"][n];
}
