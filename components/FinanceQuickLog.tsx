"use client";

import { useState } from "react";
import styles from "./FinanceQuickLog.module.css";

/**
 * FinanceQuickLog — one-line expense entry for the finance room.
 *
 * Parses shorthand like "₹450 lunch Sona" into { amount, category,
 * vendor }. The rules are forgiving; anything the parser can't pull
 * out stays editable in the three small fields that expand when the
 * user hits Enter on a bare input.
 */

interface Parsed {
  amount: number;
  vendor: string;
  category: string;
}

function parseShorthand(raw: string): Parsed | null {
  const s = raw.trim().replace(/^[₹$]\s*/, "");
  // "<amount> <category?> <vendor...>"
  // Common shapes:
  //   450 coffee Starbucks
  //   450 Starbucks
  //   450 lunch Sona Rupak
  const m = s.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!m) return null;
  const amount = Number(m[1]);
  const rest = m[2].trim();
  const parts = rest.split(/\s+/);
  // If the first token is a known-ish category word, take it.
  const CATS = new Set([
    "lunch",
    "dinner",
    "breakfast",
    "coffee",
    "tea",
    "taxi",
    "uber",
    "food",
    "groceries",
    "fuel",
    "travel",
    "flight",
    "hotel",
    "misc",
    "software",
    "subscription",
    "saas",
  ]);
  let category = "uncategorized";
  let vendor = rest;
  if (parts.length > 1 && CATS.has(parts[0].toLowerCase())) {
    category = parts[0].toLowerCase();
    vendor = parts.slice(1).join(" ");
  }
  return { amount, vendor, category };
}

type SendState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; detail: string }
  | { kind: "err"; detail: string };

export function FinanceQuickLog() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;

    const parsed = parseShorthand(raw);
    if (!parsed) {
      setState({
        kind: "err",
        detail: "try “<amount> [category] <vendor>” — e.g. 450 lunch Sona",
      });
      return;
    }

    setState({ kind: "busy" });
    try {
      const r = await fetch("/api/finance/expense", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor: parsed.vendor,
          amount: parsed.amount,
          category: parsed.category,
          description: raw,
        }),
      });
      const body = await r.text();
      if (r.ok) {
        setState({
          kind: "done",
          detail: `logged · ₹${parsed.amount.toFixed(2)} · ${parsed.vendor}`,
        });
        setValue("");
      } else {
        let detail = body;
        try {
          const j = JSON.parse(body) as Record<string, unknown>;
          detail =
            (j.error as string) || (j.detail as string) || body;
        } catch {
          /* noop */
        }
        setState({ kind: "err", detail: String(detail).slice(0, 200) });
      }
    } catch (e) {
      setState({
        kind: "err",
        detail: e instanceof Error ? e.message : "network error",
      });
    }
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.label}>quick-log expense</div>
      <form className={styles.form} onSubmit={submit}>
        <span className={styles.prompt}>₹</span>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="450 lunch Sona — press enter"
          aria-label="Quick-log expense"
          disabled={state.kind === "busy"}
        />
      </form>
      {state.kind !== "idle" && (
        <div
          className={
            state.kind === "err" ? `${styles.status} ${styles.err}` : styles.status
          }
          role="status"
        >
          {state.kind === "busy" && "sending…"}
          {state.kind === "done" && state.detail}
          {state.kind === "err" && `error · ${state.detail}`}
        </div>
      )}
    </section>
  );
}
