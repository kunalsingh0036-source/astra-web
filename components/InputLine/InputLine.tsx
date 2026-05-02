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
  const inputRef = useRef<HTMLInputElement>(null);
  const { open: openPalette } = useCommandPalette();
  const { mode } = useMode();
  const {
    ask,
    cancel,
    reset,
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

  function askOrNavigate(prompt: string) {
    if (isHomeCommand(prompt)) {
      goHome();
      return;
    }
    ask(prompt);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || isStreaming) return;
    const prompt = value;
    setValue("");
    askOrNavigate(prompt);
  }

  // Composed display value — typed value + live partial transcript
  // appended non-destructively. User can still edit `value` by typing;
  // the interim shows as a ghost append until the final chunk commits.
  const displayValue = listening && voiceInterim
    ? `${value}${value && !value.endsWith(" ") ? " " : ""}${voiceInterim}`
    : value;

  return (
    <div className={styles.dock}>
      <form
        className={`${styles.line} ${listening ? styles.listening : ""}`}
        onSubmit={handleSubmit}
      >
        {/* Kept for screen readers — visually hidden. */}
        <span className={styles.prompt}>prompt:</span>
        <input
          ref={inputRef}
          className={styles.input}
          value={displayValue}
          onChange={(e) => setValue(e.target.value)}
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
