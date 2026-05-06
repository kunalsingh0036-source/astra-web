"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for Astra's responses.
 *
 * Replaces the old renderInline (which only knew **bold**, `code`,
 * and links). The agent has always written proper markdown —
 * headings, lists, italic, code fences, blockquotes, tables — but
 * everything except the three handled cases used to fall through
 * as raw text (`### heading`, `*italic*`, ``` code ```, `- bullet`).
 *
 * Implementation:
 *   - react-markdown for parsing
 *   - remark-gfm for tables, strikethrough, task lists, autolinks
 *   - component overrides map every element to the existing design-
 *     system classes in ResponsePane.module.css (resPara, resList,
 *     resHeading1/2/3, resTable, etc.) — these CSS classes have been
 *     waiting for a renderer that actually produces them.
 *   - internal `/...` links use Next.js Link for client-side nav;
 *     external (http…) links open in a new tab.
 *
 * Stream-safe: react-markdown handles incomplete markdown gracefully
 * (a half-typed code fence renders as text + closes correctly when
 * the closing fence arrives). Re-rendered on every chunk via
 * applyEvent → text_delta; React reconciles diffs.
 */

interface MarkdownViewProps {
  text: string;
}

// Internal link detector — used to route /paths through Next.js Link
// for client-side navigation; everything else falls back to <a>.
function isInternal(href: string | undefined): boolean {
  if (!href) return false;
  return href.startsWith("/") && !href.startsWith("//");
}

export function MarkdownView({ text }: MarkdownViewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // ── Block-level structure ──────────────────────────
        p: ({ children }: ComponentProps<"p">) => (
          <p className="resPara">{children}</p>
        ),
        h1: ({ children }: ComponentProps<"h1">) => (
          <h1 className="resHeading1">{children}</h1>
        ),
        h2: ({ children }: ComponentProps<"h2">) => (
          <h2 className="resHeading2">{children}</h2>
        ),
        // h3, h4, h5, h6 all collapse to resHeading3 — the design
        // system has only three weights, deeper sections share the
        // smallest mono-label treatment.
        h3: ({ children }: ComponentProps<"h3">) => (
          <h3 className="resHeading3">{children}</h3>
        ),
        h4: ({ children }: ComponentProps<"h4">) => (
          <h4 className="resHeading3">{children}</h4>
        ),
        h5: ({ children }: ComponentProps<"h5">) => (
          <h5 className="resHeading3">{children}</h5>
        ),
        h6: ({ children }: ComponentProps<"h6">) => (
          <h6 className="resHeading3">{children}</h6>
        ),
        ul: ({ children }: ComponentProps<"ul">) => (
          <ul className="resList">{children}</ul>
        ),
        ol: ({ children }: ComponentProps<"ol">) => (
          <ol className="resList resListOrdered">{children}</ol>
        ),
        li: ({ children }: ComponentProps<"li">) => <li>{children}</li>,
        blockquote: ({ children }: ComponentProps<"blockquote">) => (
          <blockquote className="resBlockquote">{children}</blockquote>
        ),
        hr: () => <hr className="resHr" />,
        // ── Code ───────────────────────────────────────────
        // react-markdown 9.x: `code` renders both inline AND block
        // code. The `inline` prop was removed; we detect block code
        // by the presence of a className (language-*) OR by checking
        // if the parent is <pre>. Cleanest: use className presence.
        code: ({
          className,
          children,
          ...props
        }: ComponentProps<"code"> & { className?: string }) => {
          const isBlock = !!className;
          if (isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return <code {...props}>{children}</code>;
        },
        pre: ({ children }: ComponentProps<"pre">) => (
          <pre className="resPre">{children}</pre>
        ),
        // ── Tables (via remark-gfm) ────────────────────────
        // Wrapped in a scrollable div so wide tables don't blow out
        // the chat pane on narrow viewports. Same shape as the
        // existing emit_table artifact's table.
        table: ({ children }: ComponentProps<"table">) => (
          <div className="resTableWrap">
            <table className="resTable">{children}</table>
          </div>
        ),
        // ── Inline ─────────────────────────────────────────
        a: ({ href, children, ...props }: ComponentProps<"a">) => {
          // Drop unsafe schemes silently — render as plain text.
          if (
            href &&
            !href.startsWith("/") &&
            !href.startsWith("http://") &&
            !href.startsWith("https://") &&
            !href.startsWith("mailto:") &&
            !href.startsWith("tel:")
          ) {
            return <span>{children}</span>;
          }
          if (isInternal(href)) {
            return <Link href={href!}>{children}</Link>;
          }
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          );
        },
        strong: ({ children }: ComponentProps<"strong">) => (
          <strong>{children}</strong>
        ),
        em: ({ children }: ComponentProps<"em">) => <em>{children}</em>,
        del: ({ children }: ComponentProps<"del">) => <del>{children}</del>,
        // Images: render with the existing img styling. We don't
        // restrict to https here — the agent only emits images
        // it generated/fetched. For unknown-source images we'd
        // want a stricter check.
        img: ({ src, alt }: ComponentProps<"img">) =>
          src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src as string} alt={alt || ""} className="resImg" />
          ) : null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/**
 * Tiny re-export so callers don't need to import react-markdown
 * directly. The component handles all the wiring + styling.
 */
export type { MarkdownViewProps };

/**
 * For non-chat surfaces (sessions list previews, breadcrumbs) where
 * we want plain text without markdown adornment, strip syntax.
 * Cheap regex pass — not perfect but good enough for one-line
 * truncated previews where formatting doesn't matter.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Lazy fallback for places that still import renderInline. Keeps
 * the module surface intact while routing to the new MarkdownView.
 */
export function renderMarkdown(text: string): ReactNode {
  return <MarkdownView text={text} />;
}
