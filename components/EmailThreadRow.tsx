"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./EmailThreadRow.module.css";

/**
 * A single message row in the email room.
 *
 * Exposes three inline actions: archive (remove from INBOX), star
 * (toggle), and draft reply (deep-link to the canvas with a prefilled
 * prompt that asks Astra to draft a reply). Each round-trips through
 * /api/email/message/... — the email-agent does the real work.
 */

interface Message {
  id: string;
  subject: string;
  from_address: string;
  snippet: string;
  direction: string;
  is_starred?: boolean;
}

export function EmailThreadRow({ message }: { message: Message }) {
  const [starred, setStarred] = useState<boolean>(Boolean(message.is_starred));
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "done"; label: string } | { kind: "err"; label: string }
  >({ kind: "idle" });

  async function act(path: string, label: string) {
    setState({ kind: "busy" });
    try {
      const r = await fetch(`/api/email/message/${message.id}/${path}`, {
        method: "POST",
      });
      if (!r.ok) {
        const t = await r.text();
        setState({ kind: "err", label: t.slice(0, 80) });
        return;
      }
      setState({ kind: "done", label });
    } catch (e) {
      setState({
        kind: "err",
        label: e instanceof Error ? e.message : "network error",
      });
    }
  }

  async function onArchive() {
    await act("archive", "archived");
  }

  async function onStar() {
    const next = !starred;
    setStarred(next);
    await act(`star?starred=${next}`, next ? "starred" : "unstarred");
  }

  const replyPrompt = `Draft a short reply to this email from ${message.from_address}: "${message.subject}". Emit it as a draft artifact.`;

  const archived = state.kind === "done" && state.label === "archived";

  return (
    <article className={`${styles.thread} ${archived ? styles.archived : ""}`}>
      <div className={styles.top}>
        <div className={styles.from}>{message.from_address || "—"}</div>
        <div className={styles.time}>{message.direction || "inbound"}</div>
      </div>
      <div className={styles.subject}>{message.subject || "(no subject)"}</div>
      {message.snippet && <p className={styles.preview}>{message.snippet}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.actionBtn} ${starred ? styles.starred : ""}`}
          onClick={onStar}
          disabled={state.kind === "busy"}
          aria-pressed={starred}
          aria-label={starred ? "Unstar message" : "Star message"}
        >
          {starred ? "★ starred" : "☆ star"}
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={onArchive}
          disabled={state.kind === "busy" || archived}
          aria-label="Archive message"
        >
          {archived ? "archived" : "archive"}
        </button>
        <Link
          href={`/?ask=${encodeURIComponent(replyPrompt)}`}
          className={styles.actionBtn}
        >
          draft reply →
        </Link>

        {state.kind === "err" && (
          <span className={styles.err}>error · {state.label}</span>
        )}
        {state.kind === "done" && !archived && (
          <span className={styles.done}>{state.label}</span>
        )}
      </div>
    </article>
  );
}
