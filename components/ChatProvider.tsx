"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  /** True when this turn was in flight at the time the page was
   *  refreshed/closed — we recovered the partial response from
   *  localStorage. The server may have completed the work but the
   *  client never saw `done`, so this is the best snapshot we have. */
  interrupted?: boolean;
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
  /** Inject a completed turn directly into history WITHOUT routing
   *  through the agent. Used by the InputLine's deterministic-query
   *  intercepts (e.g. "pull up our last conversation" → fetch + render
   *  in <10ms instead of a 30s LLM roundtrip). */
  injectTurn: (turn: { prompt: string; response: string }) => void;
  /** Load a past session by id — fetches its turns from
   *  /api/sessions/[id], pushes them into `history`, and sets
   *  sessionRef.current so the next ask() flows under that session.
   *  Lean runtime then loads the full message stack server-side from
   *  turns.messages for proper context continuity. */
  loadSession: (sessionId: string) => Promise<void>;
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

// localStorage key + cap so a runaway-long conversation can't blow
// the 5MB browser quota. 50 turns is plenty for one continuous
// conversation; older turns drop out FIFO.
const STORAGE_KEY = "astra:chat:v1";
const MAX_PERSISTED_TURNS = 50;
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedInFlight {
  prompt: string;
  response: string;
  artifacts: Artifact[];
  toolCount: number;
  startedAt: number | null;
  lastEventAt: number | null;
}

interface PersistedState {
  sessionId: string | null;
  history: Turn[];
  lastDurationMs: number | null;
  lastCostUsd: number | null;
  /** When the snapshot was written. Stale snapshots beyond TTL are
   *  ignored on hydrate so we don't replay ancient conversations. */
  savedAt: number;
  /** Snapshot of the IN-FLIGHT turn at the moment we persisted.
   *  Captures the streaming response so a refresh mid-research
   *  recovers the partial answer instead of showing a blank canvas.
   *  On hydrate this becomes an interrupted history entry. */
  inFlight?: PersistedInFlight | null;
}

function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (
      !parsed.savedAt ||
      Date.now() - parsed.savedAt > STORAGE_TTL_MS
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistState(state: ChatState) {
  if (typeof window === "undefined") return;
  try {
    const trimmedHistory = state.history.slice(-MAX_PERSISTED_TURNS);
    const snapshot: PersistedState = {
      sessionId: state.sessionId,
      history: trimmedHistory,
      lastDurationMs: state.lastDurationMs,
      lastCostUsd: state.lastCostUsd,
      savedAt: Date.now(),
      // Snapshot the in-flight turn — including the streaming response
      // text and any artifacts that landed already. This is what makes
      // a mid-research refresh recoverable: even if the server-side
      // SSE connection dies (deploy, network blip, browser refresh),
      // the partial answer Astra had typed so far survives in the
      // browser and gets surfaced as an interrupted history entry on
      // the next page load.
      inFlight:
        state.isStreaming && state.lastPrompt
          ? {
              prompt: state.lastPrompt,
              response: state.response,
              artifacts: state.artifacts,
              toolCount: state.tools.length,
              startedAt: state.turnStartedAt,
              lastEventAt: state.lastEventAt,
            }
          : null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // Quota exceeded or storage disabled — don't break the UI over it.
    if (typeof console !== "undefined") {
      console.warn("[chat] persist failed:", e);
    }
  }
}

function clearPersisted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // Hydrate from localStorage on first render so a page refresh
  // doesn't kill conversation context. The session id is the most
  // important field — restoring it lets the next /api/chat call
  // resume the SDK's session state on the server.
  const [state, setState] = useState<ChatState>(() => {
    const saved = loadPersisted();
    if (!saved) return initial;
    let history = saved.history || [];
    // If a turn was in flight when we last persisted, surface its
    // partial response as an interrupted history entry. The user sees
    // what Astra was typing before the connection died — and any
    // artifacts that had already landed — instead of a blank canvas.
    if (saved.inFlight && saved.inFlight.prompt) {
      history = [
        ...history,
        {
          id: crypto.randomUUID(),
          prompt: saved.inFlight.prompt,
          response: saved.inFlight.response || "",
          artifacts: saved.inFlight.artifacts || [],
          toolCount: saved.inFlight.toolCount || 0,
          durationMs: null,
          costUsd: null,
          interrupted: true,
        },
      ];
    }
    return {
      ...initial,
      sessionId: saved.sessionId,
      history,
      lastDurationMs: saved.lastDurationMs,
      lastCostUsd: saved.lastCostUsd,
    };
  });
  const abortRef = useRef<AbortController | null>(null);
  // Track the latest session_id outside of React state so `ask` can
  // read it synchronously without waiting for a re-render.
  const sessionRef = useRef<string | null>(null);

  // Recover session_id from localStorage on mount so the first
  // ask() after a refresh resumes the prior SDK session rather than
  // starting a fresh one. This is what gives Astra "memory across
  // refreshes" without needing a server-side resume mechanism.
  useEffect(() => {
    const saved = loadPersisted();
    if (saved?.sessionId) {
      sessionRef.current = saved.sessionId;
    }
  }, []);

  // Persist on structural state changes — these don't fire often
  // (session start, turn complete, dismiss) and the snapshot is small.
  useEffect(() => {
    persistState(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.sessionId,
    state.history,
    state.isStreaming,
    state.lastPrompt,
    state.lastDurationMs,
    state.lastCostUsd,
  ]);

  // While a turn is streaming, snapshot the in-flight response too —
  // throttled so we don't write to localStorage on every text_delta.
  // 2s is the sweet spot: a refresh recovers near-current text without
  // thrashing the browser's synchronous storage API.
  //
  // The cleanup cancels the pending write, so if state changes again
  // before the timer fires we just reschedule. If the user closes the
  // tab between writes, we lose at most ~2s of streamed text — far
  // better than losing the entire response.
  useEffect(() => {
    if (!state.isStreaming) return;
    const id = setTimeout(() => persistState(state), 2000);
    return () => clearTimeout(id);
  }, [state]);

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
    // Also wipe the persisted snapshot so a page refresh after dismiss
    // really starts clean, not restores the old conversation.
    clearPersisted();
  }, []);

  // Inject a completed turn into history without going through the agent.
  // The InputLine uses this for deterministic intercepts (recent turns,
  // mode commands surfaced as confirmations, etc.). We mark it durationMs=0
  // so the turn header reads "answered in 0.0s" — the user can see this
  // was a local lookup, not an LLM call.
  const injectTurn = useCallback(
    ({ prompt, response }: { prompt: string; response: string }) => {
      setState((s) => ({
        ...s,
        lastPrompt: prompt,
        // Reset transient turn state so any half-open in-flight ui
        // doesn't bleed into the synthetic turn.
        response: "",
        thoughts: [],
        tools: [],
        artifacts: [],
        error: null,
        isStreaming: false,
        history: [
          ...s.history,
          {
            id: crypto.randomUUID(),
            prompt,
            response,
            artifacts: [],
            toolCount: 0,
            durationMs: 0,
            costUsd: 0,
          },
        ],
        turnStartedAt: null,
      }));
    },
    [],
  );

  // Load a past session: fetch its turns + push into history + set
  // sessionRef so the next ask() resumes under this session_id. The
  // server side (lean runtime) loads the full message stack from
  // turns.messages on its next turn, so proper multi-turn context
  // works automatically — what we display here is purely for the
  // browser UX (so you can see the conversation you're resuming).
  const loadSession = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    abortRef.current?.abort();
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState((s) => ({
          ...s,
          error: `couldn't load session: ${body.error || `HTTP ${res.status}`}`,
        }));
        return;
      }
      const json = (await res.json()) as {
        session_id: string;
        turns: Array<{
          id: number;
          prompt: string;
          response: string | null;
          status: string;
          tool_count: number;
          duration_ms: number | null;
          started_at: string;
        }>;
      };
      // Project the server-side turn rows onto our Turn type. Empty
      // responses (interrupted/failed) render as a stub so the user
      // sees the prompt + can re-ask. Skip running rows entirely —
      // they'd be confusing in the resumed history.
      const projected: Turn[] = (json.turns || [])
        .filter((t) => t.status !== "running")
        .map((t) => ({
          id: crypto.randomUUID(),
          prompt: t.prompt,
          response: t.response || "(no response — interrupted or failed)",
          artifacts: [],
          toolCount: t.tool_count || 0,
          durationMs: t.duration_ms,
          costUsd: null,
          interrupted: t.status !== "complete",
        }));
      sessionRef.current = json.session_id;
      setState((s) => ({
        ...initial,
        sessionId: json.session_id,
        history: projected,
        // Carry over the most recent turn's stats for the status bar
        lastDurationMs:
          projected.length > 0
            ? projected[projected.length - 1].durationMs
            : null,
        lastCostUsd: null,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        error: `couldn't load session: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }));
    }
  }, []);

  // URL param: /?session=<id> triggers a session resume on mount.
  // Clears the param after loading so refreshes don't re-resume on
  // top of any subsequent state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("session");
    if (!sid) return;
    void loadSession(sid).then(() => {
      // Strip the param without a navigation
      url.searchParams.delete("session");
      window.history.replaceState({}, "", url.toString());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({ ...state, ask, cancel, reset, injectTurn, loadSession }),
    [state, ask, cancel, reset, injectTurn, loadSession],
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
