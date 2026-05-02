"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./CommandPalette.module.css";
import { FLEET } from "@/lib/agents";
import { astraSoundOff, astraSoundOn, isSoundOn, playChime } from "@/lib/chimes";
import type { Agent } from "@/lib/types";

/**
 * Command palette overlay.
 *
 * Fuzzy-search over agents, actions, and memory. Keyboard-first:
 * ↑/↓ to navigate, enter to select, esc to close.
 *
 * The result shape is intentionally loose — when we wire up the real
 * agent fleet, results will come from the A2A bridge search endpoint
 * rather than being constructed locally.
 */

type ResultKind = "agent" | "action" | "suggested" | "autonomy";

interface Result {
  kind: ResultKind;
  title: React.ReactNode;
  meta: string;
  tag?: "urgent" | "agent" | "priority";
  /** What to run when the result is selected. */
  onSelect: () => void;
}

interface ActionSeed {
  title: React.ReactNode;
  meta: string;
  tag?: "urgent" | "agent" | "priority";
  route?: string;
}

// Suggested context-aware actions. Starts empty until we wire this
// to the real per-user context (unread count, overdue invoices, etc).
const SUGGESTED: ActionSeed[] = [];

// First-party navigation actions. These always appear and let you
// jump to any page in Astra without remembering the URL.
const ACTIONS: ActionSeed[] = [
  { title: "Canvas", meta: "home · the fleet at a glance", route: "/" },
  { title: "Today", meta: "dashboard · cost · agents · inbox", route: "/today" },
  { title: "Tasks", meta: "to-do · what I'm tracking", route: "/tasks" },
  { title: "Briefing", meta: "scheduler · most recent morning briefing", route: "/briefing" },
  { title: "Cost", meta: "spend · 30-day sparkline · model split", route: "/cost" },
  { title: "Audit", meta: "trust trail · every tool decision", route: "/audit" },
  { title: "Memory", meta: "long-term · semantic + keyword", route: "/memory" },
];

const AUTONOMY_MODES = [
  {
    mode: "always_ask",
    title: "Mode · always ask",
    meta: "every tool requires approval — safest",
  },
  {
    mode: "semi_auto",
    title: "Mode · semi auto",
    meta: "reads auto-approved, writes need approval — default",
  },
  {
    mode: "full_auto",
    title: "Mode · full auto",
    meta: "everything executes, audit logged — fastest",
  },
] as const;

async function setAutonomyMode(mode: string) {
  try {
    await fetch("/api/autonomy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  } catch {
    /* palette closes regardless */
  }
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/autonomy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { mode?: string }) => setCurrentMode(d.mode ?? null))
      .catch(() => setCurrentMode(null));
  }, []);

  const results = useMemo<Result[]>(() => {
    const suggested: Result[] = SUGGESTED.map((s) => ({
      kind: "suggested" as const,
      title: s.title,
      meta: s.meta,
      tag: s.tag,
      onSelect: onClose,
    }));

    const actions: Result[] = ACTIONS.map((a) => ({
      kind: "action" as const,
      title: a.title,
      meta: a.meta,
      tag: a.tag,
      onSelect: () => {
        if (a.route) router.push(a.route);
        onClose();
      },
    }));

    const soundOn = typeof window !== "undefined" ? isSoundOn() : false;
    const soundRow: Result[] = [
      {
        kind: "action" as const,
        title: soundOn ? "Sound · on" : "Sound · off",
        meta: soundOn
          ? "three subtle chimes — briefing, task done, attention. click to mute."
          : "click to enable astra's three chimes. off by default.",
        onSelect: () => {
          if (soundOn) {
            astraSoundOff();
          } else {
            astraSoundOn();
            // Preview the chime so the user hears what they enabled.
            playChime("task");
          }
          onClose();
        },
      },
    ];

    const autonomy: Result[] = AUTONOMY_MODES.map((m) => ({
      kind: "autonomy" as const,
      title:
        currentMode === m.mode ? (
          <>
            {m.title} <em>· current</em>
          </>
        ) : (
          m.title
        ),
      meta: m.meta,
      onSelect: () => {
        void setAutonomyMode(m.mode);
        setCurrentMode(m.mode);
        onClose();
      },
    }));

    const agents: Result[] = FLEET.map((agent: Agent) => ({
      kind: "agent" as const,
      title: (
        <>
          Go to <em>{agent.label}</em>
        </>
      ),
      meta: `agent · ${agent.status} · ${agent.role}`,
      tag: "agent" as const,
      onSelect: () => {
        router.push(`/agent/${agent.id}`);
        onClose();
      },
    }));

    const all = [...suggested, ...actions, ...agents, ...autonomy, ...soundRow];

    if (!query.trim()) return all;

    const q = query.toLowerCase();
    return all.filter((r) => {
      const text = typeof r.title === "string" ? r.title : JSON.stringify(r.title);
      return (
        text.toLowerCase().includes(q) || r.meta.toLowerCase().includes(q)
      );
    });
  }, [query, router, onClose, currentMode]);

  // Reset active index if query changes (otherwise we might point past end)
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        results[activeIndex]?.onSelect();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [results, activeIndex]);

  const grouped = {
    suggested: results.filter((r) => r.kind === "suggested"),
    action: results.filter((r) => r.kind === "action"),
    agent: results.filter((r) => r.kind === "agent"),
    autonomy: results.filter((r) => r.kind === "autonomy"),
  };

  let globalIndex = -1;

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.inputWrap}>
          <span className={styles.prompt}>⌘</span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="jump anywhere."
            aria-label="Command"
          />
          {query && <span className={styles.filter}>{results.length} results</span>}
        </div>

        <div className={styles.results}>
          {grouped.suggested.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupLabel}>suggested</div>
              {grouped.suggested.map((r) => {
                globalIndex++;
                return <ResultRow key={`s-${globalIndex}`} result={r} active={globalIndex === activeIndex} />;
              })}
            </section>
          )}

          {grouped.action.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupLabel}>actions</div>
              {grouped.action.map((r) => {
                globalIndex++;
                return <ResultRow key={`a-${globalIndex}`} result={r} active={globalIndex === activeIndex} />;
              })}
            </section>
          )}

          {grouped.agent.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupLabel}>agents</div>
              {grouped.agent.map((r) => {
                globalIndex++;
                return <ResultRow key={`g-${globalIndex}`} result={r} active={globalIndex === activeIndex} />;
              })}
            </section>
          )}

          {grouped.autonomy.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupLabel}>autonomy</div>
              {grouped.autonomy.map((r) => {
                globalIndex++;
                return <ResultRow key={`m-${globalIndex}`} result={r} active={globalIndex === activeIndex} />;
              })}
            </section>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerGroup}>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> select
            </span>
          </div>
          <div className={styles.footerGroup}>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}

function ResultRow({ result, active }: { result: Result; active: boolean }) {
  return (
    <button
      className={`${styles.result} ${active ? styles.active : ""}`}
      onClick={result.onSelect}
      type="button"
    >
      <span className={styles.icon}>
        <span
          className={`${styles.iconOrb} ${result.tag === "priority" || result.tag === "urgent" ? styles.bright : ""}`}
        />
      </span>
      <span className={styles.main}>
        <span className={styles.title}>{result.title}</span>
        <span className={styles.meta}>{result.meta}</span>
      </span>
      {result.tag === "urgent" && <span className={`${styles.tag} ${styles.urgent}`}>urgent</span>}
      {result.tag === "agent" && <span className={styles.tag}>agent</span>}
    </button>
  );
}
