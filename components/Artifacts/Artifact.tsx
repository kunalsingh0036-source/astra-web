"use client";

import { useMemo, useState } from "react";
import styles from "./Artifact.module.css";
import type {
  Artifact,
  DraftArtifact,
  MetricArtifact,
  TableArtifact,
} from "@/lib/artifacts";

/**
 * Artifact renderer — routes to the right component based on kind.
 *
 * Keeps the response pane clean: one Artifact component handles all
 * types, and each type has a dedicated sub-renderer that knows how
 * to present its shape with the design system.
 */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case "table":
      return <TableArtifactView a={artifact} />;
    case "draft":
      return <DraftArtifactView a={artifact} />;
    case "metric":
      return <MetricArtifactView a={artifact} />;
  }
}

/* ─── Table ────────────────────────────────────────────────── */

function TableArtifactView({ a }: { a: TableArtifact }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    if (sortCol === null) return a.rows;
    const copy = [...a.rows];
    copy.sort((r1, r2) => {
      const v1 = r1[sortCol];
      const v2 = r2[sortCol];
      if (typeof v1 === "number" && typeof v2 === "number") {
        return sortDir === "asc" ? v1 - v2 : v2 - v1;
      }
      const s1 = String(v1 ?? "");
      const s2 = String(v2 ?? "");
      return sortDir === "asc" ? s1.localeCompare(s2) : s2.localeCompare(s1);
    });
    return copy;
  }, [a.rows, sortCol, sortDir]);

  function toggleSort(i: number) {
    if (sortCol === i) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(i);
      setSortDir("asc");
    }
  }

  return (
    <figure className={styles.artifact}>
      <header className={styles.head}>
        <div className={styles.label}>table</div>
        {a.title && <h3 className={styles.title}>{a.title}</h3>}
      </header>

      <table className={styles.table}>
        <thead>
          <tr>
            {a.columns.map((col, i) => (
              <th
                key={col + i}
                onClick={() => toggleSort(i)}
                className={sortCol === i ? styles.sorted : ""}
                scope="col"
              >
                {col}
                {sortCol === i && (
                  <span className={styles.sortMark}>
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className={typeof cell === "number" ? styles.num : ""}>
                  {String(cell ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {a.caption && <figcaption className={styles.caption}>{a.caption}</figcaption>}
    </figure>
  );
}

/* ─── Draft ────────────────────────────────────────────────── */

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; detail: string }
  | { status: "error"; detail: string }
  | { status: "discarded" }
  | { status: "needs_template"; detail: string };

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
}

function DraftArtifactView({ a }: { a: DraftArtifact }) {
  const [body, setBody] = useState(a.body);
  const [subject, setSubject] = useState(a.subject);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);

  const isWhatsApp = a.channel === "whatsapp";

  async function doSend(templateName?: string, templateLanguage?: string) {
    if (!a.to) {
      setSend({ status: "error", detail: "no recipient" });
      return;
    }
    setSend({ status: "sending" });
    try {
      const res = await fetch("/api/artifact/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: a.channel,
          to: a.to,
          cc: a.cc,
          subject,
          body,
          ...(templateName
            ? { template_name: templateName, template_language: templateLanguage }
            : {}),
        }),
      });
      const text = await res.text();
      let detail = text;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
        detail =
          (parsed.gmail_id as string) ||
          (parsed.message_id as string) ||
          (parsed.status as string) ||
          (parsed.error as string) ||
          (parsed.detail as string) ||
          text;
      } catch {
        /* plain text */
      }

      if (res.ok) {
        setSend({ status: "sent", detail: String(detail) });
        return;
      }

      // WhatsApp 409: session window expired — surface template picker
      // automatically so the user can recover in-place.
      if (isWhatsApp && res.status === 409) {
        setSend({
          status: "needs_template",
          detail: "24h session window closed — pick a template to send.",
        });
        if (!templates) {
          try {
            const tr = await fetch("/api/whatsapp/templates", { cache: "no-store" });
            if (tr.ok) {
              const tj = (await tr.json()) as { templates: WhatsAppTemplate[] };
              setTemplates(tj.templates ?? []);
            }
          } catch {
            /* non-fatal — picker will render empty */
          }
        }
        return;
      }

      setSend({ status: "error", detail: String(detail) });
    } catch (e) {
      setSend({
        status: "error",
        detail: e instanceof Error ? e.message : "network error",
      });
    }
  }

  function onSend() {
    void doSend();
  }

  function onPickTemplate(t: WhatsAppTemplate) {
    void doSend(t.name, t.language);
  }

  const sent = send.status === "sent";
  const sending = send.status === "sending";
  const discarded = send.status === "discarded";
  const locked = sent || sending || discarded;

  return (
    <figure className={styles.artifact}>
      <header className={styles.head}>
        <div className={styles.label}>draft · {a.channel}</div>
      </header>

      <div className={styles.draftMeta}>
        <span className={styles.draftRow}>
          <span className={styles.draftField}>to</span>
          <span className={styles.draftValue}>{a.to || "—"}</span>
        </span>
        {a.cc && (
          <span className={styles.draftRow}>
            <span className={styles.draftField}>cc</span>
            <span className={styles.draftValue}>{a.cc}</span>
          </span>
        )}
      </div>

      {a.channel === "email" && (
        <input
          className={styles.draftSubject}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="subject"
          aria-label="Subject"
          disabled={locked}
        />
      )}

      <textarea
        className={styles.draftBody}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.max(6, Math.min(24, body.split("\n").length + 2))}
        aria-label="Draft body"
        disabled={locked}
      />

      <div className={styles.draftActions}>
        <button
          className={`${styles.draftBtn} ${styles.primary}`}
          type="button"
          onClick={onSend}
          disabled={locked}
          aria-busy={sending}
        >
          {sending ? "sending…" : sent ? "sent" : "send"}
        </button>
        <button className={styles.draftBtn} type="button" disabled>
          save for later
        </button>
        <button
          className={styles.draftBtn}
          type="button"
          onClick={() => setSend({ status: "discarded" })}
          disabled={locked}
        >
          discard
        </button>
      </div>

      {send.status !== "idle" && (
        <div
          className={
            send.status === "error"
              ? `${styles.draftStatus} ${styles.err}`
              : styles.draftStatus
          }
          role="status"
        >
          {send.status === "sending" && "dispatching to agent…"}
          {send.status === "sent" && `sent · ${send.detail}`}
          {send.status === "error" && `error · ${send.detail}`}
          {send.status === "discarded" && "discarded"}
          {send.status === "needs_template" && send.detail}
        </div>
      )}

      {send.status === "needs_template" && (
        <div className={styles.templatePicker}>
          <div className={styles.templateLabel}>approved templates</div>
          {templates === null && (
            <div className={styles.draftStatus}>loading templates…</div>
          )}
          {templates && templates.length === 0 && (
            <div className={styles.draftStatus}>
              no approved templates — submit one in Meta Business Suite.
            </div>
          )}
          {templates && templates.length > 0 && (
            <div className={styles.templateList}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.templateRow}
                  onClick={() => onPickTemplate(t)}
                >
                  <span className={styles.templateName}>{t.name}</span>
                  <span className={styles.templateMeta}>
                    {t.language} · {t.category}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/* ─── Metric ───────────────────────────────────────────────── */

function MetricArtifactView({ a }: { a: MetricArtifact }) {
  const urgent = a.tone === "urgent";
  return (
    <figure className={`${styles.artifact} ${styles.metric}`}>
      <div className={styles.metricLabel}>{a.label}</div>
      <div className={`${styles.metricValue} ${urgent ? styles.urgent : ""}`}>
        {a.value}
      </div>
      {a.sub && <div className={styles.metricSub}>{a.sub}</div>}
    </figure>
  );
}
