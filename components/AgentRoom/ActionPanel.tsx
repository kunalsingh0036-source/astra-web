"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./ActionPanel.module.css";
import type { AgentName } from "@/lib/types";

/**
 * Per-agent action panel — replaces the old 3-prompt card.
 *
 * Each agent gets a curated set of actions grouped into logical
 * sections. An action is one of:
 *
 *   1. `prompt` — fires a structured Astra prompt (deep-link to /
 *      with ?ask=...). Carries enough context that Astra knows
 *      exactly which agent and what to do, no follow-up needed.
 *
 *   2. `link` — navigates to a route that already does the thing
 *      (e.g. /email for the email pane, /memory for memory).
 *
 *   3. `custom` — renders a child component for in-room work
 *      (e.g. FinanceQuickLog inline).
 *
 * Why grouped sections vs a flat list: agents have multiple modes of
 * interaction. Grouping by intent ("read", "do", "compose") helps the
 * user pick the right action without reading every label.
 */

export interface AgentAction {
  kind: "prompt" | "link" | "custom";
  label: string;
  /** For `prompt`: the Astra prompt to fire when clicked. */
  prompt?: string;
  /** For `link`: the destination route. */
  href?: string;
  /** For `custom`: render slot key (handled by the page). */
  customKey?: string;
  /** Short hint shown below the label — explains what this does. */
  hint?: string;
  /** Optional: visually emphasize this action (the primary one). */
  primary?: boolean;
}

export interface ActionGroup {
  title: string;
  actions: AgentAction[];
}

interface Props {
  agent: AgentName;
  groups: ActionGroup[];
  /** Map of customKey → React node, supplied by the page. */
  customSlots?: Record<string, React.ReactNode>;
}

export function ActionPanel({ groups, customSlots = {} }: Props) {
  const router = useRouter();
  const [expandedCustom, setExpandedCustom] = useState<string | null>(null);

  function fire(action: AgentAction) {
    if (action.kind === "link" && action.href) {
      router.push(action.href);
      return;
    }
    if (action.kind === "prompt" && action.prompt) {
      router.push(`/?ask=${encodeURIComponent(action.prompt)}`);
      return;
    }
    if (action.kind === "custom" && action.customKey) {
      setExpandedCustom((c) => (c === action.customKey ? null : action.customKey ?? null));
    }
  }

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>actions</h2>
        <span className={styles.meta}>tap to fire · esc to cancel</span>
      </header>

      {groups.map((group) => (
        <div key={group.title} className={styles.group}>
          <div className={styles.groupTitle}>{group.title}</div>
          <div className={styles.actionGrid}>
            {group.actions.map((action) => {
              const isExpanded =
                action.kind === "custom" &&
                action.customKey === expandedCustom;
              return (
                <div key={action.label} className={styles.actionWrap}>
                  <button
                    type="button"
                    className={`${styles.action} ${
                      action.primary ? styles.actionPrimary : ""
                    } ${isExpanded ? styles.actionExpanded : ""}`}
                    onClick={() => fire(action)}
                  >
                    <span className={styles.actionLabel}>{action.label}</span>
                    {action.hint && (
                      <span className={styles.actionHint}>{action.hint}</span>
                    )}
                    <span className={styles.actionArrow} aria-hidden>
                      {action.kind === "custom"
                        ? isExpanded
                          ? "▾"
                          : "▸"
                        : "→"}
                    </span>
                  </button>
                  {isExpanded && action.customKey && customSlots[action.customKey] && (
                    <div className={styles.customSlot}>
                      {customSlots[action.customKey]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
