"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./InputLine.module.css";
import { useCommandPalette } from "@/components/CommandPalette/CommandPaletteProvider";
import { useChat } from "@/components/ChatProvider";
import { useMode } from "@/components/ModeProvider";
import { useDictation } from "@/lib/useDictation";

/**
 * Natural-language phrases that bypass the agent and just navigate home.
 * We keep the list explicit rather than fuzzy-matching so a legitimate
 * query like "what does 'return to canvas' mean?" still reaches Astra.
 */
const HOME_COMMANDS = new Set([
  "return to canvas",
  "return to astra",
  "return to the canvas",
  "back to canvas",
  "back to astra",
  "go home",
  "go back home",
  "home",
  "canvas",
  "close this",
  "dismiss",
]);

function isHomeCommand(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
  return HOME_COMMANDS.has(normalized);
}

/**
 * Recognize natural-language autonomy-mode switches in the chat
 * input and short-circuit them to the /api/autonomy endpoint instead
 * of sending them to the agent (which would currently require approval
 * to set the mode — recursive nightmare).
 *
 * Examples that match:
 *   "switch to semi-auto"
 *   "switch to semi auto"
 *   "set mode to full auto"
 *   "always ask mode"
 *   "go to full auto"
 *   "full auto mode please"
 *
 * Returns the matched mode id or null. Conservative — when the user
 * is genuinely DISCUSSING the modes ("what does semi-auto mean?")
 * we don't want to silently flip them. Only matches imperative
 * patterns + the bare mode name.
 */
const MODE_PATTERNS: Array<{ regex: RegExp; mode: "always_ask" | "semi_auto" | "full_auto" }> = [
  // Imperative phrasings
  { regex: /\b(switch|set|change|go|put|flip|toggle)\b.*?\b(to|into)?\b\s*always[\s-]ask\b/i, mode: "always_ask" },
  { regex: /\b(switch|set|change|go|put|flip|toggle)\b.*?\b(to|into)?\b\s*semi[\s-]auto\b/i, mode: "semi_auto" },
  { regex: /\b(switch|set|change|go|put|flip|toggle)\b.*?\b(to|into)?\b\s*full[\s-]auto\b/i, mode: "full_auto" },
  // Bare imperatives  ("always ask mode", "full auto please")
  { regex: /^\s*always[\s-]ask(\s+mode)?\s*\.?\s*$/i, mode: "always_ask" },
  { regex: /^\s*semi[\s-]auto(\s+mode)?\s*\.?\s*$/i, mode: "semi_auto" },
  { regex: /^\s*full[\s-]auto(\s+mode)?\s*\.?\s*$/i, mode: "full_auto" },
];

function matchModeCommand(
  value: string,
): "always_ask" | "semi_auto" | "full_auto" | null {
  const v = value.trim();
  if (!v) return null;
  // Skip obvious questions ("what does full auto mean?")
  if (/^(what|how|why|when|does|can|is|are)\b/i.test(v)) return null;
  for (const { regex, mode } of MODE_PATTERNS) {
    if (regex.test(v)) return mode;
  }
  return null;
}

/**
 * Recognize "pull up our last conversation" / "what was I just asking" /
 * "show recent turns" — deterministic queries with a known SQL shape
 * that should NEVER touch the LLM.
 *
 * Returns the desired turn count, or null if this isn't a recent-turns
 * query. The InputLine uses this to short-circuit to /api/turns/recent
 * and inject the result as a synthetic turn — answer appears in <100ms
 * instead of the 30+ seconds the agent path costs (and 10+ failure
 * points it carries).
 *
 * Conservative on intent — only matches imperative + question patterns
 * that clearly mean "show me past chat history." Anything ambiguous
 * still falls through to the agent.
 */
const RECENT_TURNS_PATTERNS: Array<{ regex: RegExp; limit: number }> = [
  // Singular "last conversation" → 1 turn
  { regex: /^\s*(pull\s*up|show|open|fetch|bring\s*up|recall)\s+(our|my|the)\s+(last|previous|most\s+recent)\s+(conversation|chat|turn|message|exchange|prompt)\s*\.?\s*$/i, limit: 1 },
  { regex: /^\s*(what\s+was|what\s+did)\s+(i|we)\s+(just\s+)?(ask|saying|talking\s+about|discuss(ing)?)\s*\??\s*$/i, limit: 1 },
  { regex: /^\s*last\s+(conversation|chat|turn|message|exchange|prompt)\s*\.?\s*$/i, limit: 1 },
  // Plural "recent N" → up to 5
  { regex: /^\s*(show|pull\s*up|open)\s+(my|our|the)?\s*(recent|last)\s+(\d+\s+)?(conversations|chats|turns|messages|exchanges)\s*\.?\s*$/i, limit: 5 },
  { regex: /^\s*(show|pull\s*up)\s+(my|our|the)?\s*(history|chat\s+history)\s*\.?\s*$/i, limit: 5 },
];

/**
 * Recognize phrases that should navigate to the /sessions page —
 * the user wants to browse + resume past chats. Distinct from
 * `recall_recent_turns` (which renders the answer inline) because
 * here the user explicitly wants the LIST UI, not a quick lookup.
 */
const SESSIONS_PAGE_PATTERNS: Array<RegExp> = [
  /^\s*(show|open|see|view)\s+(?:my\s+|the\s+|all\s+)?(?:past\s+|previous\s+)?(?:chat\s+)?sessions\s*\.?\s*$/i,
  /^\s*(show|open|see|view)\s+(?:my\s+|all\s+)?(past|previous|prior)\s+chats\s*\.?\s*$/i,
  /^\s*(open|go\s+to)\s+(?:the\s+)?(sessions|chat\s+history|history\s+page)\s*\.?\s*$/i,
  /^\s*(?:my\s+)?chat\s+history\s*\.?\s*$/i,
  /^\s*(?:my\s+)?sessions\s*\.?\s*$/i,
];

function matchSessionsNavCommand(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // Skip questions ("what's a session?")
  if (/^(what|how|why|when|does|can|is|are)\b/i.test(v)) return false;
  return SESSIONS_PAGE_PATTERNS.some((r) => r.test(v));
}

/**
 * Recognize "expand bridge to <path>" / "give astra access to <path>" /
 * "add <path> to the bridge" — natural-language shortcuts that update
 * the active bridge token's allowed_paths via /api/bridge/expand.
 *
 * The agent itself is taught (via system prompt) to suggest this exact
 * phrasing when it needs a directory outside the current allowlist.
 * Routing it through the chat layer (not through the agent's tool
 * call path) avoids the recursive "agent needs permission to give
 * itself permission" problem.
 *
 * Returns the path(s) to add, or null if the input is something else.
 */
const BRIDGE_EXPAND_PATTERNS: Array<RegExp> = [
  // "expand bridge to /path/here"
  /^\s*expand\s+(?:the\s+)?bridge\s+to\s+(.+?)\s*$/i,
  // "add /path/here to the bridge"
  /^\s*add\s+(.+?)\s+to\s+(?:the\s+)?bridge\s*$/i,
  // "give astra access to /path/here"
  /^\s*give\s+astra\s+access\s+to\s+(.+?)\s*$/i,
  // "let astra read /path/here"
  /^\s*let\s+astra\s+(?:read|access|see)\s+(.+?)\s*$/i,
];

function matchBridgeExpandCommand(value: string): string[] | null {
  const v = value.trim();
  if (!v) return null;
  for (const regex of BRIDGE_EXPAND_PATTERNS) {
    const m = v.match(regex);
    if (m) {
      // Split on commas / "and" so the user can add multiple paths
      // in one go: "expand bridge to /a, /b, and /c"
      const raw = m[1] || "";
      const paths = raw
        .split(/\s*,\s*|\s+and\s+/i)
        .map((s) => s.trim().replace(/[`"']/g, ""))
        .filter((s) => s.startsWith("/"));
      if (paths.length > 0) return paths;
    }
  }
  return null;
}

function matchRecentTurnsCommand(value: string): { limit: number } | null {
  const v = value.trim();
  if (!v) return null;
  for (const { regex, limit } of RECENT_TURNS_PATTERNS) {
    const m = v.match(regex);
    if (m) {
      // Try to parse "show recent 3 turns" → limit = 3
      const numMatch = v.match(/\b(\d+)\b/);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n > 0 && n <= 20) return { limit: n };
      }
      return { limit };
    }
  }
  return null;
}

interface RecentTurn {
  id: number;
  prompt: string;
  response: string | null;
  status: string;
  duration_ms: number | null;
  started_at: string;
}

function formatTurnsForChat(turns: RecentTurn[]): string {
  if (turns.length === 0) {
    return "No prior turns recorded yet — the turns table is fresh and only captures conversations from this point forward.";
  }
  if (turns.length === 1) {
    const t = turns[0];
    const ts = new Date(t.started_at).toLocaleString();
    const dur =
      t.duration_ms !== null
        ? ` · ${(t.duration_ms / 1000).toFixed(1)}s`
        : "";
    const statusNote =
      t.status === "complete"
        ? ""
        : ` · ${t.status}`;
    return [
      `Last turn (${ts}${dur}${statusNote}):`,
      "",
      `**you asked:**`,
      t.prompt,
      "",
      `**i answered:**`,
      t.response || "(no response — turn was interrupted or failed before completion)",
    ].join("\n");
  }
  const lines: string[] = [`Last ${turns.length} turns, newest first:`, ""];
  for (const t of turns) {
    const ts = new Date(t.started_at).toLocaleString();
    const dur =
      t.duration_ms !== null
        ? ` · ${(t.duration_ms / 1000).toFixed(1)}s`
        : "";
    const statusNote = t.status === "complete" ? "" : ` · ${t.status}`;
    lines.push(`---`);
    lines.push(`**${ts}${dur}${statusNote}**`);
    lines.push(`**you:** ${t.prompt}`);
    lines.push(
      `**astra:** ${(t.response || "(interrupted)").slice(0, 600)}${(t.response || "").length > 600 ? "…" : ""}`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * The input line at the bottom of the canvas.
 *
 * Always present, always focused. Submitting opens a live stream to
 * Astra core through the chat proxy. While streaming, the input is
 * disabled and shows "astra is thinking…".
 *
 * Esc aborts an in-flight stream. The Chat provider handles state;
 * this component is just the shell.
 */
export function InputLine() {
  const [value, setValue] = useState("");
  // Voice state — mirrors the input value while the user is speaking
  // so partial transcripts show up without clobbering typed text.
  const [voiceInterim, setVoiceInterim] = useState("");
  const baseBeforeVoiceRef = useRef<string>("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The whole dock — needed so we can measure its actual rendered
  // height (input + attachments + chrome) and publish it as a CSS
  // variable. ResponsePane uses that variable for its bottom anchor
  // so the textarea growing tall doesn't overlap the conversation.
  const dockRef = useRef<HTMLDivElement>(null);

  // Attachment state. Each item is a file the user has dropped /
  // pasted / picked. They render as chips above the textarea and
  // get prepended to the prompt at submit time.
  //
  // Folders are flattened to a list of files via webkitdirectory —
  // a single Astra prompt can attach a whole folder this way and
  // we count them as one logical attachment with the folder name.
  type Attachment = {
    id: string;
    name: string;
    mime: string;
    size: number;
    /** For images: base64 data URL for inline display + send. */
    dataUrl?: string;
    /** For images: the raw File so handleSubmit can upload it
     *  multipart. dataUrl is fine for in-browser preview but
     *  uploading via dataUrl would force a base64 → bytes
     *  round-trip; sending the File directly is leaner. */
    file?: File;
    /** For non-image files: shown as a name chip only (no preview). */
    isImage: boolean;
    /** For folder uploads: the folder root name. Same string across
     *  all files dropped together via a directory pick. */
    folder?: string;
  };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Tracks an in-progress upload while we POST images to
   *  /api/uploads. Disables the submit button so the user can't
   *  fire two ask() calls in parallel and end up with a partial
   *  attachment set. */
  const [uploading, setUploading] = useState(false);

  // Auto-grow the textarea on every value change. We measure scrollHeight
  // and set explicit height so the field expands to fit content. CSS
  // caps max-height; once content exceeds that the textarea scrolls
  // internally rather than pushing the page chrome.
  const autoGrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Reset to auto first so shrinking works (otherwise scrollHeight
    // stays at the previous high-water mark).
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Publish the dock's actual rendered height as a CSS custom property
  // (--input-dock-height). The ResponsePane reads this for its bottom
  // anchor: when the textarea grows tall (long prompt), the pane's
  // bottom edge lifts to match, so the input dock and conversation
  // never overlap. Without this, a 5-line prompt covered the bottom
  // of Astra's response.
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof window === "undefined") return;
    const root = document.documentElement;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      // 8px breathing room above the dock so the pane border doesn't
      // kiss the dock's hairline.
      root.style.setProperty("--input-dock-height", `${Math.ceil(h) + 8}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    // Window resize can change line-wrap; recompute then too.
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--input-dock-height");
    };
  }, []);
  const { open: openPalette } = useCommandPalette();
  const { mode } = useMode();
  const {
    ask,
    cancel,
    reset,
    injectTurn,
    isStreaming,
    response,
    artifacts,
    error,
    lastPrompt,
  } = useChat();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // True when the response pane is currently showing something
  // dismissible — any of these means there's an open dialog overlay.
  const hasOpenPane =
    Boolean(lastPrompt || response || error) || artifacts.length > 0;

  function goHome() {
    reset();
    if (pathname !== "/") router.push("/");
  }

  // ─── Attachments ──────────────────────────────────────────
  //
  // Three intake paths:
  //   1. Click the paperclip → file picker (multi-select, images
  //      get previews; any other file shows as a name chip).
  //   2. Click the folder icon → webkitdirectory picker; whole
  //      folder is attached as a single logical group.
  //   3. Drag-drop onto the dock OR paste an image from clipboard.
  //
  // Sending: at submit time we build a prompt-prefix block listing
  // attachment names + (if image) inline data URLs. The backend
  // currently doesn't process image content blocks via the SSE
  // path — that's a backend follow-up. The UX of attaching is
  // already useful (Kunal can see and review what's attached
  // before send) and the prompt-prefix gives the agent at least
  // descriptive context.

  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB per file
  const MAX_ATTACHMENTS = 20;

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  const ingestFiles = useCallback(
    async (files: File[], folderName?: string) => {
      // Cap total + per-file size to avoid choking the prompt.
      const fresh: Attachment[] = [];
      for (const file of files) {
        if (fresh.length + attachments.length >= MAX_ATTACHMENTS) break;
        if (file.size > MAX_ATTACHMENT_BYTES) continue;
        const isImage = file.type.startsWith("image/");
        let dataUrl: string | undefined;
        if (isImage) {
          try {
            dataUrl = await readAsDataUrl(file);
          } catch {
            /* if we can't preview, still attach as a name chip */
          }
        }
        fresh.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
          // Keep the original File ref for images so handleSubmit
          // can upload it multipart without re-encoding the dataUrl.
          file: isImage ? file : undefined,
          isImage,
          folder: folderName,
        });
      }
      if (fresh.length) {
        setAttachments((prev) => [...prev, ...fresh]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachments.length],
  );

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function pickFiles() {
    fileInputRef.current?.click();
  }

  function pickFolder() {
    folderInputRef.current?.click();
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void ingestFiles(files);
    // Reset so picking the same file twice fires a change event.
    e.target.value = "";
  }

  function handleFolderPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    // The webkitRelativePath looks like "MyFolder/sub/file.png".
    // Use the first segment as the folder display name.
    type WithRel = File & { webkitRelativePath?: string };
    const root =
      (files[0] as WithRel).webkitRelativePath?.split("/")[0] ||
      "folder";
    void ingestFiles(files, root);
    e.target.value = "";
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    const fileLikes: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) fileLikes.push(f);
      }
    }
    if (fileLikes.length) {
      // Only intercept paste when there's a file — text paste falls
      // through to default behavior.
      e.preventDefault();
      void ingestFiles(fileLikes);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLFormElement>) {
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function handleDragLeave() {
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent<HTMLFormElement>) {
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      e.preventDefault();
      void ingestFiles(files);
    }
  }

  // ─── Dictation (toggle-to-talk) ──────────────────────────
  //
  // One click or hotkey to start, one to stop. Works with text already
  // in the input — dictation appends. Partial transcripts render live;
  // final chunks commit to `value`. Silence auto-stops after 4s.
  // Nothing auto-submits — the user always reviews and hits Enter.

  const onInterim = useCallback((partial: string) => {
    setVoiceInterim(partial);
  }, []);
  const onFinal = useCallback((final: string) => {
    setVoiceInterim("");
    setValue((cur) => {
      // Append (don't replace) so the user can keep dictating over
      // multiple silence-stop cycles within one "listening" session.
      const base = (cur || "").trimEnd();
      const sep = base.length > 0 && !base.endsWith(" ") ? " " : "";
      return (base + sep + final).trimStart();
    });
    inputRef.current?.focus();
  }, []);
  const {
    supported: voiceSupported,
    listening,
    toggle: toggleDictation,
    stop: stopDictation,
  } = useDictation({ onInterim, onFinal });

  function beginDictation() {
    if (!voiceSupported || isStreaming) return;
    baseBeforeVoiceRef.current = value;
    setVoiceInterim("");
    toggleDictation();
  }
  function endDictation() {
    stopDictation();
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // `/` can be visited with ?ask=... from agent rooms and quick cards.
  // When that param is present and we're not already streaming, fire
  // the prompt directly into Astra and clear the URL. Guards against
  // re-firing on reload by using a ref of the consumed value.
  const consumedAskRef = useRef<string | null>(null);
  useEffect(() => {
    if (pathname !== "/") return;
    const ask = searchParams?.get("ask")?.trim();
    if (!ask || consumedAskRef.current === ask || isStreaming) return;
    consumedAskRef.current = ask;
    // Strip the query from the URL so reload doesn't resubmit.
    router.replace("/");
    setValue("");
    void ask; // referenced below
    // Defer one tick so the route cleanup finishes first.
    queueMicrotask(() => ask && askOrNavigate(ask));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams, isStreaming]);

  // When the stream ends, re-focus the field so the next query is
  // a keystroke away.
  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  // Toggle-to-talk hotkey: ⌘⇧; (Mac) / Ctrl⇧; (others).
  // Chose semicolon because it's on the right-hand side of any keyboard,
  // doesn't clash with a browser shortcut, and isn't a character you'd
  // accidentally type in a prompt. Works regardless of input focus, so
  // you can dictate even while the response pane has focus elsewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      // KeyboardEvent.code for ; is "Semicolon"; some layouts may fire
      // Period instead, so accept either.
      if (e.code !== "Semicolon" && e.code !== "Period") return;
      if (!voiceSupported || isStreaming) return;
      e.preventDefault();
      if (listening) endDictation();
      else beginDictation();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSupported, isStreaming, listening]);

  // Esc escalates through three states, in order of precedence:
  //   1. If a stream is running → cancel it.
  //   2. Else if dictation is running → stop it (don't dismiss pane).
  //   3. Else if the response pane is open → dismiss it (reset chat).
  //   4. Else if we're not already on "/" → go home.
  // The command palette handles its own Esc internally, so we let
  // those keydowns bubble up only when it isn't open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;

      // Don't hijack Esc when the user is typing in a non-main input
      // (e.g. the draft artifact subject/body textareas). Those fields
      // should drop focus on Esc, not dismiss the whole dialog.
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        active !== inputRef.current &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
      ) {
        return;
      }

      if (isStreaming) {
        e.preventDefault();
        cancel();
        return;
      }
      if (listening) {
        e.preventDefault();
        endDictation();
        return;
      }
      if (hasOpenPane) {
        e.preventDefault();
        reset();
        return;
      }
      if (pathname !== "/") {
        e.preventDefault();
        goHome();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, hasOpenPane, pathname]);

  function askOrNavigate(prompt: string, attachments: string[] = []) {
    if (isHomeCommand(prompt)) {
      goHome();
      return;
    }
    // Sessions page: "show my chat history", "open past sessions",
    // "my chats", etc. — pure navigation, no agent involved.
    if (matchSessionsNavCommand(prompt)) {
      router.push("/sessions");
      return;
    }
    // Recent-turns shortcut: queries like "pull up our last conversation"
    // are deterministic SQL — `SELECT * FROM turns ORDER BY started_at
    // DESC LIMIT N`. Routing through the agent SDK costs ~30s of LLM
    // round-tripping AND adds 10+ failure points (CLI subprocess, hook
    // callbacks, embedding cold start, etc.) for what should be one
    // database query. Hit /api/turns/recent directly and inject the
    // result as a synthetic chat turn — answer appears in <100ms.
    //
    // This is the proof-of-pattern for a broader principle: not every
    // input needs the LLM. Deterministic queries get a deterministic
    // path; the agent handles open-ended reasoning.
    // Bridge-expand shortcut: "expand bridge to /Users/.../X" hits
    // /api/bridge/expand directly instead of routing through the agent.
    // The agent is told (via system prompt) to suggest this exact
    // phrasing when it needs an out-of-allowlist path.
    const bridgePaths = matchBridgeExpandCommand(prompt);
    if (bridgePaths) {
      void fetch("/api/bridge/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: bridgePaths }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            injectTurn({
              prompt,
              response: `Couldn't expand bridge: ${body.error || `HTTP ${r.status}`}`,
            });
            return;
          }
          const added = (body.added as string[]) || [];
          const all = (body.allowed_paths as string[]) || [];
          const summary =
            added.length === 0
              ? `All requested paths were already in the allowlist. Current allowlist (${all.length}):\n${all.map((p) => `  - ${p}`).join("\n")}`
              : `Added ${added.length} path(s) to bridge token #${body.token_id}:\n${added.map((p) => `  + ${p}`).join("\n")}\n\nCurrent allowlist (${all.length}):\n${all.map((p) => `  - ${p}`).join("\n")}`;
          injectTurn({ prompt, response: summary });
        })
        .catch((e: unknown) => {
          injectTurn({
            prompt,
            response: `Couldn't expand bridge: ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
        });
      return;
    }

    const recentMatch = matchRecentTurnsCommand(prompt);
    if (recentMatch) {
      void fetch(`/api/turns/recent?limit=${recentMatch.limit}`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((body: { turns?: RecentTurn[]; error?: string }) => {
          const text = body.error
            ? `Couldn't read turns table: ${body.error}`
            : formatTurnsForChat(body.turns || []);
          injectTurn({ prompt, response: text });
        })
        .catch((e: unknown) => {
          injectTurn({
            prompt,
            response: `Couldn't read turns table: ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
        });
      return;
    }
    // Mode-switch shortcut: typing/speaking "switch to full auto" hits
    // /api/autonomy directly instead of routing through the agent.
    // Avoids the recursive "agent needs approval to set its own mode"
    // problem from the ⌘K palette UX bug.
    const mode = matchModeCommand(prompt);
    if (mode) {
      void fetch("/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      })
        .then((r) => r.json().catch(() => ({})))
        .then((body: { mode?: string; error?: string }) => {
          // Surface the change as if the agent had said it — we cheat
          // through the chat provider's local state by sending a tiny
          // synthetic prompt that the agent will treat as a confirmation
          // request. Cleaner: flash a toast. Simplest right now: just
          // log it so the user sees something happened.
          if (body.mode) {
            // eslint-disable-next-line no-console
            console.info("[autonomy] switched to", body.mode);
          } else if (body.error) {
            console.warn("[autonomy] switch failed:", body.error);
          }
        })
        .catch((e) => console.warn("[autonomy] switch failed:", e));
      // Drop a confirmation note via the chat reset/lastPrompt path
      // so the user sees acknowledgement on screen.
      ask(`Switched autonomy mode to ${mode.replace("_", " ")}.`);
      return;
    }
    ask(prompt, attachments);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Allow submit even when text is empty IF there are attachments —
    // user can paste an image and ask "what is this?" without typing.
    if (!value.trim() && attachments.length === 0) return;
    if (isStreaming || uploading) return;

    // Split attachments into images-to-upload vs non-image references.
    // Images become real content blocks the agent can see. Non-image
    // attachments (folders, other files) still surface as a textual
    // header so the agent has context.
    const imageAtts = attachments.filter((a) => a.isImage && a.file);
    const nonImageAtts = attachments.filter(
      (a) => !a.isImage || !a.file,
    );

    // Upload images first, gather their server-side IDs. Done IN
    // PARALLEL because each upload is independent. If ANY upload
    // fails, surface the error and bail before clearing the input —
    // the user keeps their typed text + attachments to retry.
    let uploadIds: string[] = [];
    if (imageAtts.length > 0) {
      setUploading(true);
      try {
        const results = await Promise.allSettled(
          imageAtts.map(async (a) => {
            const fd = new FormData();
            fd.append("file", a.file as File, a.name);
            const r = await fetch("/api/uploads", {
              method: "POST",
              body: fd,
            });
            if (!r.ok) {
              const body = await r.text();
              throw new Error(
                `upload "${a.name}" failed: ${r.status} ${body.slice(0, 120)}`,
              );
            }
            const j = (await r.json()) as { id?: string };
            if (!j.id) throw new Error(`upload "${a.name}" returned no id`);
            return j.id;
          }),
        );
        const failures = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => String(r.reason).slice(0, 200));
        if (failures.length > 0) {
          // Bail without clearing input so user can retry.
          if (typeof window !== "undefined") {
            window.alert(
              `Upload failed for ${failures.length} of ${imageAtts.length} image(s):\n` +
                failures.join("\n"),
            );
          }
          setUploading(false);
          return;
        }
        uploadIds = results.flatMap((r) =>
          r.status === "fulfilled" ? [r.value] : [],
        );
      } catch (e) {
        if (typeof window !== "undefined") {
          window.alert(
            `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // Build the prompt text. Non-image attachments get a textual
    // header (the agent has no vision tool for arbitrary files yet);
    // image attachments don't need a header because they're real
    // content blocks the model will see directly.
    let prompt = value.trim();
    if (nonImageAtts.length > 0) {
      const folderGroups = new Map<string, number>();
      const loose: typeof nonImageAtts = [];
      for (const a of nonImageAtts) {
        if (a.folder) {
          folderGroups.set(a.folder, (folderGroups.get(a.folder) || 0) + 1);
        } else {
          loose.push(a);
        }
      }
      const lines: string[] = [];
      for (const [folder, n] of folderGroups) {
        lines.push(`📁 ${folder}/  (${n} file${n === 1 ? "" : "s"})`);
      }
      for (const a of loose) {
        const sizeKb = (a.size / 1024).toFixed(1);
        lines.push(`📎  ${a.name}  (${a.mime}, ${sizeKb} KB)`);
      }
      const header = `[attached]\n${lines.join("\n")}`;
      prompt = prompt ? `${header}\n\n${prompt}` : header;
    }
    // If user only attached an image with no text, give the agent a
    // gentle nudge so it doesn't sit there waiting for instruction.
    if (!prompt && uploadIds.length > 0) {
      prompt = "What do you see here?";
    }

    setValue("");
    setAttachments([]);
    // Reset the textarea height after submit so the next input starts
    // at the resting one-line height rather than the post-multiline
    // expanded size.
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.style.height = "auto";
    });
    askOrNavigate(prompt, uploadIds);
  }

  // Standard chat-input semantics on the textarea:
  //   Enter           → submit the prompt
  //   Shift+Enter     → insert a newline (multi-line message)
  //   ⌘/Ctrl+Enter    → also submit (some users default to this)
  // IME composition is respected — Enter during composition (e.g.
  // confirming a Chinese/Japanese candidate) does NOT submit.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;
    if (e.shiftKey) return; // user wants a newline
    e.preventDefault();
    handleSubmit(e as unknown as React.FormEvent);
  }

  // Re-grow whenever the displayed value changes (typed input OR
  // a final voice transcript landing).
  useEffect(() => {
    autoGrow();
  }, [value, voiceInterim, autoGrow]);

  // Composed display value — typed value + live partial transcript
  // appended non-destructively. User can still edit `value` by typing;
  // the interim shows as a ghost append until the final chunk commits.
  const displayValue = listening && voiceInterim
    ? `${value}${value && !value.endsWith(" ") ? " " : ""}${voiceInterim}`
    : value;

  return (
    <div ref={dockRef} className={styles.dock}>
      {/* Attachment chips render ABOVE the input line so the dock grows
          upward as files pile up. Each chip is dismissible. Image
          attachments show a tiny preview thumbnail; non-image files
          show a paperclip icon + name. */}
      {attachments.length > 0 && (
        <div className={styles.attachments} aria-label="Attachments">
          {attachments.map((a) => (
            <div key={a.id} className={styles.chip}>
              {a.isImage && a.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.dataUrl}
                  alt=""
                  className={styles.chipThumb}
                />
              ) : (
                <span className={styles.chipIcon}>
                  {a.folder ? "📁" : "📎"}
                </span>
              )}
              <span className={styles.chipName}>
                {a.folder ? `${a.folder}/` : a.name}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className={`${styles.line} ${listening ? styles.listening : ""} ${dragOver ? styles.dragOver : ""}`}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hidden file inputs — triggered by the paperclip / folder buttons. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.fileInputHidden}
          onChange={handleFilePick}
          aria-hidden
          tabIndex={-1}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error — webkitdirectory is non-standard but
          // widely supported (Chrome, Edge, Safari, Firefox).
          webkitdirectory=""
          directory=""
          multiple
          className={styles.fileInputHidden}
          onChange={handleFolderPick}
          aria-hidden
          tabIndex={-1}
        />

        {/* Kept for screen readers — visually hidden. */}
        <span className={styles.prompt}>prompt:</span>

        {/* Attach button (paperclip) — opens the image/file picker. */}
        {!isStreaming && (
          <button
            type="button"
            className={styles.attachBtn}
            onClick={pickFiles}
            onContextMenu={(e) => {
              // Right-click = pick a folder instead. Discoverable hint
              // via title; keeps the chrome minimal.
              e.preventDefault();
              pickFolder();
            }}
            aria-label="Attach files (right-click for folder)"
            title="attach files · right-click for folder"
          >
            <span className={styles.attachIcon}>+</span>
          </button>
        )}

        <textarea
          ref={inputRef}
          className={styles.input}
          value={displayValue}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isStreaming
              ? "thinking — esc to stop"
              : listening
                ? "listening…"
                : "speak."
          }
          disabled={isStreaming}
          aria-label="Ask astra"
          autoFocus
          rows={1}
          spellCheck
        />
        {voiceSupported && !isStreaming && (
          <button
            type="button"
            className={`${styles.mic} ${listening ? styles.micLive : ""}`}
            aria-label={listening ? "stop dictation" : "start dictation"}
            aria-pressed={listening}
            title={listening ? "stop (⌘⇧;)" : "dictate (⌘⇧;)"}
            onClick={(e) => {
              e.preventDefault();
              if (listening) endDictation();
              else beginDictation();
            }}
          >
            <span className={styles.micDot} />
          </button>
        )}
        {!value && !isStreaming && !listening && (
          <span className={styles.cursor} aria-hidden />
        )}
      </form>
      <div className={styles.hint}>
        <span className={styles.hintLeft}>
          {voiceSupported && (
            <>
              <kbd className={styles.kbdHotkey}>⌘⇧;</kbd>
              <span className={styles.kbdLabel}> dictate</span>
              <span className={styles.hintSep}> · </span>
            </>
          )}
          <kbd
            onClick={openPalette}
            role="button"
            tabIndex={0}
            className={styles.kbdCommands}
            aria-label="open command palette"
          >
            <span className={styles.kbdHotkey}>⌘K</span>
            <span className={styles.kbdLabel}> commands</span>
          </kbd>
        </span>
        <span className={styles.hintRight}>
          <kbd className={mode === "monastic" ? styles.kbdActive : undefined}>⌘1</kbd> monastic{" "}
          <kbd className={mode === "editorial" ? styles.kbdActive : undefined}>⌘2</kbd> editorial{" "}
          <kbd className={mode === "ops" ? styles.kbdActive : undefined}>⌘3</kbd> ops
        </span>
      </div>
    </div>
  );
}
