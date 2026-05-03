"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { startChatStream, type ChatEvent } from "@/lib/chatStream";
import { parseArtifact, type Artifact } from "@/lib/artifacts";
import { playChime } from "@/lib/chimes";
import type { AgentName } from "@/lib/types";

/**
 * Chat state — everything the UI needs to render a single conversation.
 *
 * The conversation is single-turn for Phase 3: each `ask()` starts a
 * new stream. Multi-turn (with prior history sent along) is a one-line
 * change once Astra core has session persistence wired up.
 */

export interface Thought {
  id: string;
  text: string;
  /** Fading thoughts stick around at reduced opacity until the next. */
  stale: boolean;
}

export interface ToolActivity {
  id: string;
  name: string;
  agent: AgentName | null;
  state: "running" | "ok" | "error";
  preview?: string;
}

export interface Turn {
  id: string;
  prompt: string;
  response: string;
  artifacts: Artifact[];
  toolCount: number;
  durationMs: number | null;
  costUsd: number | null;
}

export interface ChatState {
  /** True while a stream is open. */
  isStreaming: boolean;
  /** Most recent user query for display. */
  lastPrompt: string | null;
  /** Incremental assistant text for the current turn. */
  response: string;
  /** Thoughts surfaced during the turn — newest first. */
  thoughts: Thought[];
  /** Tool activity table — lets the canvas know which orb to light. */
  tools: ToolActivity[];
  /** Structured artifacts emitted during the turn. */
  artifacts: Artifact[];
  /** Error message if the stream failed. */
  error: string | null;
  /** Duration of the last completed turn. */
  lastDurationMs: number | null;
  /** Cost of the last completed turn (USD). */
  lastCostUsd: number | null;
  /** SDK session id for multi-turn continuity. */
  sessionId: string | null;
  /** Completed turns in this conversation (oldest → newest). */
  history: Turn[];
  /** epoch ms — when the in-flight turn started. null if no active turn. */
  turnStartedAt: number | null;
  /** epoch ms — last time ANY event arrived (text/tool/thought). Used by
   *  the live status bar to detect stalls (no events for N seconds). */
  lastEventAt: number | null;
}

interface ChatContextValue extends ChatState {
  ask: (prompt: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const initial: ChatState = {
  isStreaming: false,
  lastPrompt: null,
  response: "",
  thoughts: [],
  tools: [],
  artifacts: [],
  error: null,
  lastDurationMs: null,
  lastCostUsd: null,
  sessionId: null,
  history: [],
  turnStartedAt: null,
  lastEventAt: null,
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChatState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  // Track the latest session_id outside of React state so `ask` can
  // read it synchronously without waiting for a re-render.
  const sessionRef = useRef<string | null>(null);

  const ask = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Tear down any in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset the *turn-local* fields but keep session + history.
    const now = Date.now();
    setState((s) => ({
      ...s,
      isStreaming: true,
      lastPrompt: trimmed,
      response: "",
      thoughts: [],
      tools: [],
      artifacts: [],
      error: null,
      turnStartedAt: now,
      lastEventAt: now,
    }));

    try {
      await startChatStream({
        prompt: trimmed,
        sessionId: sessionRef.current,
        signal: controller.signal,
        onEvent: (event) => applyEvent(event, setState, sessionRef, trimmed),
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = e instanceof Error ? e.message : "stream failed";
      setState((s) => ({ ...s, isStreaming: false, error: message }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setState(initial);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({ ...state, ask, cancel, reset }),
    [state, ask, cancel, reset],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

function applyEvent(
  event: ChatEvent,
  setState: React.Dispatch<React.SetStateAction<ChatState>>,
  sessionRef: React.MutableRefObject<string | null>,
  currentPrompt: string,
) {
  // Bump lastEventAt on every event so the live status bar can detect
  // stalls (no event for N seconds while still streaming).
  const eventArrivedAt = Date.now();
  setState((s) => {
    // The case-specific switch returns the new state; we mix in
    // lastEventAt at the end to avoid repeating it in every branch.
    const updated = applyEventInner(event, s, sessionRef, currentPrompt);
    return { ...updated, lastEventAt: eventArrivedAt };
  });
}

function applyEventInner(
  event: ChatEvent,
  s: ChatState,
  sessionRef: React.MutableRefObject<string | null>,
  currentPrompt: string,
): ChatState {
  // The original applyEvent body, restructured to return the new state
  // instead of calling setState directly. The wrapper above adds
  // lastEventAt uniformly so we don't have to repeat it in each case.
  switch (event.type) {
    case "session":
      if (event.session_id) {
        sessionRef.current = event.session_id;
      }
      return { ...s, sessionId: event.session_id || s.sessionId };
    case "thought": {
      const next: Thought[] = [
        { id: crypto.randomUUID(), text: event.text, stale: false },
        ...s.thoughts.slice(0, 5).map((t) => ({ ...t, stale: true })),
      ];
      return { ...s, thoughts: next };
    }
    case "tool_call": {
      const agent = (event.agent as AgentName | null) ?? null;
      return {
        ...s,
        tools: [
          ...s.tools,
          { id: event.id, name: event.name, agent, state: "running" },
        ],
      };
    }
    case "tool_result": {
      const tools = s.tools.map((t) =>
        t.id === event.id
          ? { ...t, state: event.is_error ? "error" : "ok", preview: event.preview }
          : t,
      );
      return { ...s, tools: tools as ToolActivity[] };
    }
    case "text_delta":
      return { ...s, response: s.response + event.content };
    case "artifact": {
      const parsed = parseArtifact(event.content);
      if (!parsed) return s;
      return { ...s, artifacts: [...s.artifacts, parsed] };
    }
    case "done": {
      const turn: Turn = {
        id: crypto.randomUUID(),
        prompt: currentPrompt,
        response: s.response,
        artifacts: s.artifacts,
        toolCount: s.tools.length,
        durationMs: event.duration_ms,
        costUsd: event.cost_usd ?? null,
      };
      playChime("task");
      return {
        ...s,
        isStreaming: false,
        lastDurationMs: event.duration_ms,
        lastCostUsd: event.cost_usd ?? null,
        thoughts: s.thoughts.map((t) => ({ ...t, stale: true })),
        history: [...s.history, turn],
        turnStartedAt: null,
      };
    }
    case "error":
      return { ...s, isStreaming: false, error: event.message, turnStartedAt: null };
  }
  return s;
}
