"use client";

import { useMemo, useState } from "react";
import styles from "./Artifact.module.css";
import type {
  Artifact,
  DraftArtifact,
  ImageArtifact,
  MetricArtifact,
  PaletteArtifact,
  PreviewArtifact,
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
    case "palette":
      return <PaletteArtifactView a={artifact} />;
    case "preview":
      return <PreviewArtifactView a={artifact} />;
    case "image":
      return <ImageArtifactView a={artifact} />;
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

/* ─── Palette ──────────────────────────────────────────────── */

function PaletteArtifactView({ a }: { a: PaletteArtifact }) {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // Pick contrasting text color for the swatch label so it stays
  // readable on dark AND light swatches without a designer manually
  // tagging each one. WCAG-ish: relative luminance threshold ~0.55.
  const contrastFor = (hex: string): "light" | "dark" => {
    const m = hex.replace("#", "");
    if (m.length !== 6 && m.length !== 3) return "light";
    const exp = m.length === 3
      ? m.split("").map((c) => c + c).join("")
      : m;
    const r = parseInt(exp.slice(0, 2), 16) / 255;
    const g = parseInt(exp.slice(2, 4), 16) / 255;
    const b = parseInt(exp.slice(4, 6), 16) / 255;
    // Approximate relative luminance
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.55 ? "dark" : "light";
  };

  const onCopy = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(
        () => setCopiedHex((c) => (c === hex ? null : c)),
        1200,
      );
    } catch {
      // Clipboard denied (insecure context) — fall back to no-op;
      // user can long-press / right-click the swatch to copy manually.
    }
  };

  return (
    <figure className={`${styles.artifact} ${styles.palette}`}>
      <header className={styles.head}>
        <span className={styles.label}>palette</span>
        {a.name && <span className={styles.title}>{a.name}</span>}
      </header>
      <div className={styles.paletteGrid}>
        {a.colors.map((c, i) => {
          const tone = contrastFor(c.hex);
          const wasCopied = copiedHex === c.hex;
          return (
            <button
              key={`${c.hex}-${i}`}
              type="button"
              className={`${styles.swatch} ${
                tone === "light"
                  ? styles.swatchLight
                  : styles.swatchDark
              }`}
              style={{ background: c.hex }}
              onClick={() => onCopy(c.hex)}
              aria-label={`copy ${c.hex}${c.label ? ` — ${c.label}` : ""}`}
              title={c.label ? `${c.hex} · ${c.label}` : c.hex}
            >
              <span className={styles.swatchHex}>
                {wasCopied ? "copied" : c.hex.toLowerCase()}
              </span>
              {c.label && (
                <span className={styles.swatchLabel}>{c.label}</span>
              )}
            </button>
          );
        })}
      </div>
      {a.notes && <p className={styles.paletteNotes}>{a.notes}</p>}
    </figure>
  );
}

/* ─── Preview ──────────────────────────────────────────────── */

function PreviewArtifactView({ a }: { a: PreviewArtifact }) {
  const [expanded, setExpanded] = useState(false);

  // Inline iframe only makes sense for stored same-origin previews
  // AND content types the browser knows how to render (HTML, image,
  // PDF, plain text). For url-mode previews, X-Frame-Options on
  // most third-party sites blocks embedding — fall back to "open
  // in tab" only.
  const canIframe = a.mode === "inline";
  const inlineUrl = a.previewId ? `/api/preview/${a.previewId}` : null;
  const openUrl = a.mode === "url" ? a.url : inlineUrl;

  if (!openUrl) {
    return null;
  }

  return (
    <figure className={`${styles.artifact} ${styles.preview}`}>
      <header className={styles.head}>
        <span className={styles.label}>preview</span>
        <span className={styles.title}>{a.title || "untitled preview"}</span>
      </header>

      {canIframe && inlineUrl && (
        <div
          className={`${styles.previewFrame} ${
            expanded ? styles.previewFrameExpanded : ""
          }`}
        >
          {/* Sandbox: scripts run (so the agent's HTML is interactive),
              same-origin denied (the iframe can't read parent cookies
              or DOM), forms allowed (so a draft mockup with a form
              can demo). No popups, no top-level navigation. */}
          <iframe
            src={inlineUrl}
            className={styles.previewIframe}
            title={a.title || "preview"}
            sandbox="allow-scripts allow-forms allow-popups-to-escape-sandbox"
            loading="lazy"
          />
        </div>
      )}

      <div className={styles.previewActions}>
        <a
          className={styles.previewBtn}
          href={openUrl}
          target="_blank"
          rel="noreferrer"
        >
          open in tab →
        </a>
        {canIframe && (
          <button
            type="button"
            className={styles.previewBtn}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "shrink" : "expand"}
          </button>
        )}
      </div>

      {a.notes && <p className={styles.previewNotes}>{a.notes}</p>}
    </figure>
  );
}

/* ─── Image ────────────────────────────────────────────────── */

function ImageArtifactView({ a }: { a: ImageArtifact }) {
  const [expanded, setExpanded] = useState(false);

  // Format byte_count → "200 KB" / "1.4 MB" for the meta line. Used
  // to set expectations on slow connections + as a sanity hint when
  // the image is unexpectedly huge.
  const sizeLabel = a.byteCount ? formatBytes(a.byteCount) : "";
  const dimLabel =
    a.width && a.height ? `${a.width}×${a.height}` : "";
  const meta = [dimLabel, sizeLabel].filter(Boolean).join(" · ");

  return (
    <figure className={`${styles.artifact} ${styles.image}`}>
      <header className={styles.head}>
        <span className={styles.label}>image</span>
        <span className={styles.title}>{a.title || "untitled image"}</span>
      </header>

      <div
        className={`${styles.imageFrame} ${
          expanded ? styles.imageFrameExpanded : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.url}
          alt={a.alt || a.title || ""}
          className={styles.imageContent}
          loading="lazy"
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <div className={styles.imageActions}>
        <a
          className={styles.previewBtn}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          download={a.url.startsWith("data:") ? imageFileName(a) : undefined}
        >
          {a.url.startsWith("data:") ? "download" : "open in tab →"}
        </a>
        {a.sourceUrl &&
          a.sourceUrl !== a.url && (
            <a
              className={styles.previewBtn}
              href={a.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              visit source →
            </a>
          )}
        {meta && <span className={styles.imageMeta}>{meta}</span>}
      </div>

      {a.notes && <p className={styles.previewNotes}>{a.notes}</p>}
    </figure>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function imageFileName(a: ImageArtifact): string {
  const base = (a.title || "screenshot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "screenshot"}.png`;
}
