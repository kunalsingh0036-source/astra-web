import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Lightweight inline renderer for Astra's streaming responses.
 *
 * Handles three things only:
 *   - [text](url) links — internal (/-prefixed) routes use Next.js Link
 *     so navigation is client-side; external (http…) stay as <a>.
 *   - **bold** segments
 *   - `inline code`
 *
 * Anything else is preserved verbatim. This is not a full markdown
 * parser — it's a pragmatic inline layer so Astra's "[open](/email)"
 * suggestions turn into real tappable links on the phone.
 */

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const CODE_RE = /`([^`]+)`/g;

export function renderInline(text: string): ReactNode {
  const out: ReactNode[] = [];
  // Split text line-by-line so streaming whitespace is preserved.
  const lines = text.split(/\n/);
  lines.forEach((line, idx) => {
    out.push(...renderLine(line, `${idx}`));
    if (idx < lines.length - 1) out.push(<br key={`br-${idx}`} />);
  });
  return out;
}

function renderLine(line: string, keyBase: string): ReactNode[] {
  // Walk the line, pulling out the highest-priority match at each step.
  // Priority: link > bold > code > literal.
  const tokens: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < line.length) {
    const linkMatch = matchAt(line, i, LINK_RE);
    const boldMatch = matchAt(line, i, BOLD_RE);
    const codeMatch = matchAt(line, i, CODE_RE);
    const candidates: Array<{ idx: number; match: RegExpExecArray; kind: "link" | "bold" | "code" }> = [];
    if (linkMatch) candidates.push({ idx: linkMatch.index, match: linkMatch, kind: "link" });
    if (boldMatch) candidates.push({ idx: boldMatch.index, match: boldMatch, kind: "bold" });
    if (codeMatch) candidates.push({ idx: codeMatch.index, match: codeMatch, kind: "code" });
    if (candidates.length === 0) {
      tokens.push(<span key={`${keyBase}-${key++}`}>{line.slice(i)}</span>);
      break;
    }
    candidates.sort((a, b) => a.idx - b.idx);
    const chosen = candidates[0];
    if (chosen.idx > i) {
      tokens.push(<span key={`${keyBase}-${key++}`}>{line.slice(i, chosen.idx)}</span>);
    }
    if (chosen.kind === "link") {
      const [, label, href] = chosen.match;
      if (href.startsWith("/")) {
        tokens.push(
          <Link key={`${keyBase}-${key++}`} href={href}>
            {label}
          </Link>,
        );
      } else if (/^https?:/.test(href)) {
        tokens.push(
          <a key={`${keyBase}-${key++}`} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>,
        );
      } else {
        // Unknown scheme — render label as plain text; avoids turning
        // things like `[1](foo)` footnotes into broken links.
        tokens.push(<span key={`${keyBase}-${key++}`}>{chosen.match[0]}</span>);
      }
      i = chosen.idx + chosen.match[0].length;
    } else if (chosen.kind === "bold") {
      tokens.push(<strong key={`${keyBase}-${key++}`}>{chosen.match[1]}</strong>);
      i = chosen.idx + chosen.match[0].length;
    } else {
      tokens.push(<code key={`${keyBase}-${key++}`}>{chosen.match[1]}</code>);
      i = chosen.idx + chosen.match[0].length;
    }
  }
  return tokens;
}

function matchAt(text: string, from: number, re: RegExp): RegExpExecArray | null {
  // Clone the regex so we get fresh lastIndex state
  const r = new RegExp(re.source, re.flags);
  r.lastIndex = from;
  return r.exec(text);
}
