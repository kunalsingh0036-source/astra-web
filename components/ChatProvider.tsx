"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import type { ChatEvent } from "@/lib/chatStream";
import { startChatPoll, cancelTurn, pollTurn } from "@/lib/chatPoller";
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
   *  refreshed/closed AND we couldn't recover a clean completion
   *  from the server (turn 404, status='interrupted'/'failed', or
   *  resume polling itself errored). The browser is showing the
   *  partial response we'd persisted locally — the server's truth
   *  is unknown or worse than what we have. */
  interrupted?: boolean;
  /** True when the turn was in flight at the time the page was
   *  refreshed/closed BUT the server-side run continued and
   *  finished cleanly (status='complete'). Polling on hydrate
   *  recovered the full response; the user sees a fully-formed
   *  answer with a "completed while you were away" badge so they
   *  understand why this turn just appeared. Only set when
   *  durationMs and the response come from the server's terminal
   *  state, not from localStorage. */
  completedWhileAway?: boolean;
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
  /** Server-side turn id, captured via chatPoller's onTurnId.
   *  This is the field that unlocks resume-on-hydrate: with the id
   *  we can hit /api/turns/<id>/events and pull whatever the
   *  server has, finished or otherwise. Backwards-compat: older
   *  snapshots without turnId fall back to the old "show as
   *  interrupted" path. */
  turnId?: number | null;
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

function persistState(state: ChatState, turnId: number | null) {
  if (typeof window === "undefined") return;
  try {
    const trimmedHistory = state.history.slice(-MAX_PERSISTED_TURNS);
    const snapshot: PersistedState = {
      sessionId: state.sessionId,
      history: trimmedHistory,
      lastDurationMs: state.lastDurationMs,
      lastCostUsd: state.lastCostUsd,
      savedAt: Date.now(),
      // Snapshot the in-flight turn including the partial response
      // AND the server-side turn id. The id is what makes "completed
      // while you were away" possible: on next mount we hit
      // /api/turns/<id>/events, learn the turn finished hours ago,
      // and surface the full server-side response. The local
      // response/artifacts fields stay as a fallback for the rare
      // case where the server lost the row.
      inFlight:
        state.isStreaming && state.lastPrompt
          ? {
              prompt: state.lastPrompt,
              response: state.response,
              artifacts: state.artifacts,
              toolCount: state.tools.length,
              startedAt: state.turnStartedAt,
              lastEventAt: state.lastEventAt,
              turnId,
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

/**
 * Returns true when the current page URL has `?session=<id>` — i.e.
 * the user navigated here by clicking a row on /sessions and
 * explicitly wants THAT session's history, not whatever stale
 * inFlight state localStorage happens to be holding.
 *
 * The hydrate, the resumeTurnIdRef init, and the resume effect ALL
 * branch on this so they can't race with loadSession.
 *
 * Bug it fixes: clicking a session on /sessions opened /?session=<id>
 * but the conversation never rendered — the hydrate showed a phantom
 * "thinking…" indicator from saved.inFlight, the resume effect
 * kicked off a poll for that stale turn id, and loadSession's
 * setState got clobbered by the in-flight events landing later. The
 * net effect was the user staring at an empty / thinking pane while
 * the API had already returned the right turns.
 */
function urlHasSessionParam(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has("session");
  } catch {
    return false;
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // Hydrate from localStorage on first render so a page refresh
  // doesn't kill conversation context.
  //
  // Three persistence cases for an in-flight turn:
  //   A. Saved with turnId — we'll resume against the server. Don't
  //      add to history yet; the resume effect (below) decides
  //      whether the turn finished cleanly (completedWhileAway) or
  //      needs to be marked interrupted. Show the prompt as the
  //      "current" turn with isStreaming=true so the user sees the
  //      same thinking-indicator they had before the refresh.
  //   B. Saved without turnId (legacy snapshot from pre-Phase-2b
  //      builds) — fall back to the old "show as interrupted with
  //      partial response" behavior since we can't resume.
  //   C. No in-flight — normal restore.
  const [state, setState] = useState<ChatState>(() => {
    // If the URL says "load this session", don't even look at
    // saved.inFlight — the user's intent is clear and any phantom
    // "still thinking" state from a stale localStorage entry would
    // confuse the UI while loadSession's fetch is mid-flight.
    // loadSession will set the real session state once it returns.
    if (urlHasSessionParam()) {
      return initial;
    }
    const saved = loadPersisted();
    if (!saved) return initial;
    const history = saved.history || [];
    const inFlight = saved.inFlight;
    const canResume = !!(inFlight && inFlight.prompt && inFlight.turnId);
    // Case B: legacy snapshot. Push the partial response as an
    // interrupted entry the same way we used to — no resume path.
    if (inFlight && inFlight.prompt && !inFlight.turnId) {
      return {
        ...initial,
        sessionId: saved.sessionId,
        history: [
          ...history,
          {
            id: crypto.randomUUID(),
            prompt: inFlight.prompt,
            response: inFlight.response || "",
            artifacts: inFlight.artifacts || [],
            toolCount: inFlight.toolCount || 0,
            durationMs: null,
            costUsd: null,
            interrupted: true,
          },
        ],
        lastDurationMs: saved.lastDurationMs,
        lastCostUsd: saved.lastCostUsd,
      };
    }
    // Case A: resumable. Surface the prompt as the active turn so
    // the in-flight panel renders, but DON'T push to history yet —
    // the resume effect will decide where it lands.
    if (canResume) {
      return {
        ...initial,
        sessionId: saved.sessionId,
        history,
        lastDurationMs: saved.lastDurationMs,
        lastCostUsd: saved.lastCostUsd,
        isStreaming: true,
        lastPrompt: inFlight!.prompt,
        // Seed accumulators with whatever we'd persisted. The resume
        // poll replays from ord=0 so these get rebuilt anyway, but
        // seeding them prevents a flash of empty state on slow
        // mobile networks while the first poll is in flight.
        response: inFlight!.response || "",
        artifacts: inFlight!.artifacts || [],
        turnStartedAt: inFlight!.startedAt,
        lastEventAt: inFlight!.lastEventAt,
      };
    }
    // Case C: nothing in flight.
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
  // Server-side turn id of the currently in-flight turn. Captured
  // via chatPoller's onTurnId callback as soon as POST /api/chat
  // returns. Cancel() reads this synchronously to fire a server-
  // side cancel (POST /api/turns/<id>/cancel) so we stop spending
  // tokens on a turn the user no longer wants. Cleared when the
  // turn reaches a terminal state.
  const turnIdRef = useRef<number | null>(null);
  // Set on hydrate when there's a resumable in-flight turn. The
  // resume effect picks this up, calls pollTurn, and folds the
  // result into history. null means no resume needed.
  //
  // Suppressed when the URL has ?session=<id> — that's an explicit
  // "load this session" intent, and racing it against a stale
  // resume poll loses every time (the poll's events overwrite
  // loadSession's history).
  const resumeTurnIdRef = useRef<number | null>(
    typeof window !== "undefined" && !urlHasSessionParam()
      ? loadPersisted()?.inFlight?.turnId ?? null
      : null,
  );

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
    persistState(state, turnIdRef.current);
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
    const id = setTimeout(() => persistState(state, turnIdRef.current), 2000);
    return () => clearTimeout(id);
  }, [state]);

  // Watchdog — auto-clear a stuck "thinking" state.
  //
  // With Phase 2b polling (lib/chatPoller.ts), the turn runs server-
  // side regardless of whether the browser is currently polling, so
  // a "no events for N seconds" condition means one of:
  //   - the server-side asyncio.Task wedged without writing anything
  //   - the turn_events read endpoint is broken / DB is down
  //   - the runner finished but turns.status update never landed
  // In all three cases, the durable poll path (chatPoller's
  // maxPollDurationMs = 10min) eventually fires, but a tighter
  // browser watchdog gives the user a faster "retry" affordance.
  //
  // The agent's own hard cap is 240s (_TURN_HARD_TIMEOUT_SEC); we
  // wait 90s past that — 330s — so we never declare a turn dead
  // while the runner is still legitimately working. See
  // docs/timeout_hierarchy.md for the full layering.
  useEffect(() => {
    if (!state.isStreaming) return;
    if (state.lastEventAt === null) return;
    const elapsed = Date.now() - state.lastEventAt;
    const WATCHDOG_MS = 330_000;
    const remaining = Math.max(0, WATCHDOG_MS - elapsed);
    const id = setTimeout(() => {
      // Re-check on fire — state may have changed
      const since = Date.now() - (state.lastEventAt ?? Date.now());
      if (since < WATCHDOG_MS) return;
      // Abort any in-flight fetch (best effort)
      abortRef.current?.abort();
      setState((s) => ({
        ...s,
        isStreaming: false,
        error:
          "no events from server for 5.5 minutes — assuming the stream is dead. retry.",
      }));
    }, remaining);
    return () => clearTimeout(id);
  }, [state.isStreaming, state.lastEventAt]);

  const ask = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Tear down any in-flight poll
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Drop any stale turn id from a prior turn so a cancel() racing
    // with the new ask() can't accidentally fire a cancel against
    // the old turn's id.
    turnIdRef.current = null;

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
      const { turnId } = await startChatPoll({
        prompt: trimmed,
        sessionId: sessionRef.current,
        signal: controller.signal,
        onEvent: (event) => applyEvent(event, setState, sessionRef, trimmed),
        onTurnId: (id) => {
          // Captured the moment POST /api/chat returns, BEFORE we
          // start polling — so the Cancel button is wired up even
          // for a turn the user wants to kill in the first second.
          turnIdRef.current = id;
        },
      });
      // Whatever happened — terminal, abort, timeout — the turn id
      // is no longer "current". Clearing prevents a stray cancel()
      // call from hitting an already-finished turn id.
      if (turnIdRef.current === turnId) {
        turnIdRef.current = null;
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = e instanceof Error ? e.message : "poll failed";
      setState((s) => ({ ...s, isStreaming: false, error: message }));
    }
  }, []);

  const cancel = useCallback(() => {
    // Fire-and-forget the server-side cancel so the agent stops
    // burning tokens on work the user no longer wants. The local
    // abort is what actually stops the UX (poll loop sees
    // signal.aborted and returns immediately).
    const inFlightTurnId = turnIdRef.current;
    if (inFlightTurnId !== null) {
      void cancelTurn(inFlightTurnId);
      turnIdRef.current = null;
    }
    abortRef.current?.abort();
    setState((s) => ({ ...s, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    // Same server-side cancellation as cancel() — a "new conversation"
    // gesture should also stop the previous turn from burning tokens.
    const inFlightTurnId = turnIdRef.current;
    if (inFlightTurnId !== null) {
      void cancelTurn(inFlightTurnId);
      turnIdRef.current = null;
    }
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
    // Switching sessions = abandon the in-flight turn. Stop the
    // server-side task too, otherwise it keeps spending API tokens
    // on a conversation the user has navigated away from.
    const inFlightTurnId = turnIdRef.current;
    if (inFlightTurnId !== null) {
      void cancelTurn(inFlightTurnId);
      turnIdRef.current = null;
    }
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

  // URL param /?session=<id> triggers a session load — see
  // <UrlSessionWatcher> below for the details + why it's an extra
  // child component instead of an effect right here.

  // Resume on hydrate — the killer feature of polling architecture.
  //
  // If the previous session left an in-flight turn with a known
  // turn_id, we ask the server whether it finished. Three outcomes:
  //
  //   - Finished cleanly hours ago: the first poll comes back with
  //     terminal=true and the full event log. applyEvent replays
  //     into history with completedWhileAway=true. The user opens
  //     the laptop, sees their answer ready. Total resume time:
  //     <1s on a warm DB.
  //
  //   - Still running: rare but possible (long agent run, DB stall).
  //     pollTurn keeps polling under the regular timeout — the user
  //     sees the same "thinking" UI they had before refresh.
  //
  //   - Server lost the turn (404, DB wipe): error event fires,
  //     the in-flight panel resolves to an error state. Better
  //     than the old behavior (silent stuck-in-thinking forever).
  //
  // Cancel/dismiss works on a resumed turn too — turnIdRef is set
  // to the same id chatPoller would have set, so the cancel button
  // hits /api/turns/<id>/cancel correctly.
  useEffect(() => {
    // Belt-and-suspenders: even if resumeTurnIdRef was set, skip
    // when the URL says "load a specific session". The hydrate
    // already nulled this out in that case, but checking again
    // costs nothing and makes the invariant explicit.
    if (urlHasSessionParam()) {
      resumeTurnIdRef.current = null;
      return;
    }
    const resumeTurnId = resumeTurnIdRef.current;
    if (!resumeTurnId) return;
    // Clear so a future state change can't accidentally re-trigger.
    resumeTurnIdRef.current = null;

    const saved = loadPersisted();
    const promptText = saved?.inFlight?.prompt ?? "";
    if (!promptText) return;

    const controller = new AbortController();
    abortRef.current = controller;
    turnIdRef.current = resumeTurnId;

    (async () => {
      try {
        const { turnId } = await pollTurn({
          turnId: resumeTurnId,
          signal: controller.signal,
          // Replay from 0 — server is the source of truth. The
          // accumulators we seeded in hydrate get rebuilt as
          // events flow in. Any divergence between local
          // localStorage state and the server's truth resolves
          // toward the server's truth, which is what we want.
          startOrd: 0,
          onEvent: (event) =>
            applyEvent(event, setState, sessionRef, promptText, true),
        });
        if (turnIdRef.current === turnId) {
          turnIdRef.current = null;
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const message = e instanceof Error ? e.message : "resume failed";
        setState((s) => ({ ...s, isStreaming: false, error: message }));
      }
    })();
    // Mount-only: refs make this idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({ ...state, ask, cancel, reset, injectTurn, loadSession }),
    [state, ask, cancel, reset, injectTurn, loadSession],
  );

  return (
    <ChatContext.Provider value={value}>
      <Suspense fallback={null}>
        <UrlSessionWatcher
          sessionRef={sessionRef}
          loadSession={loadSession}
        />
      </Suspense>
      {children}
    </ChatContext.Provider>
  );
}

/**
 * Watches the `?session=<id>` URL parameter and triggers loadSession
 * when it changes. Lives as a separate child component (not an
 * effect inside ChatProvider) for two reasons:
 *
 *   1. Next 16 requires `useSearchParams` callers to be inside a
 *      Suspense boundary. Putting it on ChatProvider directly
 *      broke `next build` on /_not-found prerender. A small
 *      watcher child + a Suspense wrapper keeps the parent
 *      provider Suspense-free.
 *
 *   2. ChatProvider mounts once at the root layout and persists
 *      across client-side navigation. A mount-only effect inside
 *      it would NEVER fire when the user clicks a session row
 *      (Next.js Link routes within the same React tree). useSearch
 *      Params is the supported API to react to URL changes —
 *      that's why we use it here instead of reading window.location
 *      manually.
 *
 * Idempotence: skips when sessionParam matches sessionRef.current,
 * so a re-render or back-button shuffle doesn't re-fetch.
 *
 * After load: strips the `session` param via history.replaceState
 * so refreshes don't keep replaying it.
 */
function UrlSessionWatcher({
  sessionRef,
  loadSession,
}: {
  sessionRef: React.MutableRefObject<string | null>;
  loadSession: (sessionId: string) => Promise<void>;
}) {
  const searchParams = useSearchParams();
  const sessionParam = searchParams?.get("session") ?? null;
  useEffect(() => {
    if (!sessionParam) return;
    if (sessionParam === sessionRef.current) return;
    void loadSession(sessionParam).then(() => {
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("session");
        window.history.replaceState({}, "", url.toString());
      }
    });
  }, [sessionParam, loadSession, sessionRef]);
  return null;
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
  isResume: boolean = false,
) {
  // Bump lastEventAt on every event so the live status bar can detect
  // stalls (no event for N seconds while still streaming).
  const eventArrivedAt = Date.now();
  setState((s) => {
    // The case-specific switch returns the new state; we mix in
    // lastEventAt at the end to avoid repeating it in every branch.
    const updated = applyEventInner(event, s, sessionRef, currentPrompt, isResume);
    return { ...updated, lastEventAt: eventArrivedAt };
  });
}

function applyEventInner(
  event: ChatEvent,
  s: ChatState,
  sessionRef: React.MutableRefObject<string | null>,
  currentPrompt: string,
  isResume: boolean,
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
        // Resume = the user closed/refreshed during a turn, came
        // back, polling found it already complete. The turn
        // appearing in history is unexpected from the user's POV
        // ("I didn't ask anything just now") — the badge tells them
        // why.
        completedWhileAway: isResume ? true : undefined,
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
