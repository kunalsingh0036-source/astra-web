/**
 * Chat poller — Phase 2b consumer.
 *
 * Replaces lib/chatStream.ts's SSE consumer with a polling loop.
 * Why: streaming made us subject to every duration cap in the path
 * (Vercel maxDuration, Cloudflare Tunnel, intermediate proxies).
 * Long agent turns routinely got cut off mid-flight. Polling is
 * immune — each poll request is short, finishes fast, the agent
 * runs server-side regardless of whether the browser is currently
 * polling.
 *
 * Flow:
 *   1. POST /api/chat with the prompt → returns { turn_id }
 *   2. Poll /api/turns/<id>/events?after=<lastOrd> every ~500ms
 *   3. For each new event in the response: emit it to the consumer
 *      (same ChatEvent shape the old SSE consumer used)
 *   4. When the response reports `terminal: true`, stop polling
 *      and emit a synthetic done event
 *
 * Cancellation:
 *   - AbortSignal stops local polling instantly
 *   - POST /api/turns/<id>/cancel tells the server to abort the
 *     in-flight asyncio task — saves API tokens for unwanted runs
 */

import type { ChatEvent } from "./chatStream";

export interface StartPollOptions {
  prompt: string;
  sessionId?: string | null;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  /**
   * Upload IDs returned by POST /api/uploads. Each gets attached
   * to the user message as an image content block by the lean
   * runtime. Empty/undefined = pure text turn.
   */
  attachments?: string[];
  /**
   * Fired ONCE, as soon as POST /api/chat returns the turn_id.
   * The consumer (ChatProvider) needs the id before the poll
   * resolves so the Cancel button can call /api/turns/[id]/cancel
   * mid-flight. Not getting the turn_id is a non-fatal condition —
   * the start request failed and an error event will follow.
   */
  onTurnId?: (turnId: number) => void;
  /**
   * How often to poll for new events. 500ms balances UI snappiness
   * against DB load + bandwidth. Text-deltas can fire dozens of
   * times per second on the agent side; the browser doesn't need
   * to render at that resolution.
   */
  pollIntervalMs?: number;
  /**
   * Max time we're willing to wait for terminal. Defaults to 10
   * minutes — well above the runner's 240s hard cap, but bounded
   * so a forever-stuck row doesn't leave the browser polling
   * forever.
   */
  maxPollDurationMs?: number;
}

interface StartChatResponse {
  turn_id: number;
  session_id: string | null;
  status: string;
}

interface PollEvent {
  ord: number;
  event: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface PollResponse {
  turn_id: number;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  terminal: boolean;
  events: PollEvent[];
}

const DEFAULT_POLL_MS = 500;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000; // 10 min
// Adaptive backoff cap. After ~6 consecutive empty polls (~10s of
// idle), we throttle to one poll per 5s. Snaps back to base on the
// next batch of events. Saves ~10× DB load when the agent is
// thinking but not emitting (e.g. waiting on a slow tool).
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const BACKOFF_GROWTH = 1.5;

export async function startChatPoll({
  prompt,
  sessionId,
  signal,
  onEvent,
  onTurnId,
  attachments,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxPollDurationMs = DEFAULT_MAX_DURATION_MS,
}: StartPollOptions): Promise<{ turnId: number | null }> {
  // ── Step 1: enqueue the turn ──
  let startResp: Response;
  try {
    startResp = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(attachments && attachments.length > 0
          ? { attachments }
          : {}),
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { turnId: null };
    onEvent({
      type: "error",
      message: e instanceof Error ? e.message : "couldn't reach /api/chat",
    });
    onEvent({ type: "done", duration_ms: 0 });
    return { turnId: null };
  }

  if (!startResp.ok) {
    const body = await startResp.json().catch(() => ({}));
    onEvent({
      type: "error",
      message:
        (body as { error?: string }).error || `HTTP ${startResp.status}`,
    });
    onEvent({ type: "done", duration_ms: 0 });
    return { turnId: null };
  }

  const start = (await startResp.json()) as StartChatResponse;
  if (!start.turn_id) {
    onEvent({
      type: "error",
      message: "stream service didn't return turn_id",
    });
    onEvent({ type: "done", duration_ms: 0 });
    return { turnId: null };
  }

  // Surface the turn_id IMMEDIATELY so the consumer can wire up
  // a Cancel button that calls /api/turns/<id>/cancel mid-flight.
  // If we waited until startChatPoll resolved, the user couldn't
  // cancel a long turn — exactly the case where cancellation
  // matters most.
  try {
    onTurnId?.(start.turn_id);
  } catch {
    // never let a consumer callback kill the poll loop
  }

  // ── Step 2: poll for events until terminal ──
  return pollTurn({
    turnId: start.turn_id,
    signal,
    onEvent,
    pollIntervalMs,
    maxPollDurationMs,
  });
}

export interface PollTurnOptions {
  turnId: number;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  /** Base poll interval. Adaptive backoff grows it during idle
   *  stretches; resets to this value on the next batch of events. */
  pollIntervalMs?: number;
  /** Cap for adaptive backoff. Defaults to 5s. */
  maxBackoffMs?: number;
  /** Hard ceiling on total poll duration. */
  maxPollDurationMs?: number;
  /**
   * Resume from a specific ord. Defaults to 0 (replay from start).
   * Replay is idempotent — text_delta concatenates, tool events
   * accumulate, the consumer ends up in the same state. Pass a
   * non-zero value if the caller has already applied earlier events
   * and only wants new ones (e.g. live-running turn that lost the
   * fetch midstream and is reconnecting).
   */
  startOrd?: number;
}

/**
 * Poll an existing turn's events until it reaches a terminal state.
 * Used in two paths:
 *
 *   1. Live turn — startChatPoll calls this after POST /api/chat
 *      returns a turn_id. The consumer already has a fresh, empty
 *      ChatState; events flow in real time.
 *
 *   2. Resume on hydrate — ChatProvider mounts with a saved
 *      `inFlight.turnId` from a prior session. This function replays
 *      events from ord=0 so the consumer rebuilds the response,
 *      tools, artifacts deterministically. If the turn already
 *      finished server-side (the common "completed while you were
 *      away" case), the terminal event lands in the first poll and
 *      the loop exits in <1s.
 */
export async function pollTurn({
  turnId,
  signal,
  onEvent,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  maxPollDurationMs = DEFAULT_MAX_DURATION_MS,
  startOrd = 0,
}: PollTurnOptions): Promise<{ turnId: number }> {
  let lastOrd = startOrd;
  let emptyPollCount = 0;
  let interval = pollIntervalMs;
  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) return { turnId };
    if (Date.now() - startedAt > maxPollDurationMs) {
      onEvent({
        type: "error",
        message: `polling exceeded ${Math.round(
          maxPollDurationMs / 60000,
        )}min — turn probably orphaned. retry.`,
      });
      onEvent({ type: "done", duration_ms: Date.now() - startedAt });
      return { turnId };
    }

    let resp: Response;
    try {
      resp = await fetch(`/api/turns/${turnId}/events?after=${lastOrd}`, {
        signal,
        cache: "no-store",
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return { turnId };
      // Network blip — wait + retry. Don't kill the loop on
      // transient failures.
      await sleep(pollIntervalMs * 2);
      continue;
    }

    if (!resp.ok) {
      // 4xx/5xx — surface and stop
      const body = await resp.json().catch(() => ({}));
      onEvent({
        type: "error",
        message:
          (body as { error?: string }).error || `events HTTP ${resp.status}`,
      });
      onEvent({ type: "done", duration_ms: Date.now() - startedAt });
      return { turnId };
    }

    const body = (await resp.json()) as PollResponse;

    for (const ev of body.events) {
      lastOrd = Math.max(lastOrd, ev.ord);
      const translated = translateEvent(ev);
      if (translated) onEvent(translated);
    }

    // Adaptive backoff: snap interval to base on any new events,
    // grow geometrically on consecutive empty polls. Capped so a
    // long-running tool call (no events for 30s+) settles into a
    // 5s cadence — still snappy enough that the user perceives
    // continuity but ~10× cheaper than 500ms polling.
    if (body.events.length > 0) {
      emptyPollCount = 0;
      interval = pollIntervalMs;
    } else {
      emptyPollCount += 1;
      interval = Math.min(
        maxBackoffMs,
        Math.round(pollIntervalMs * Math.pow(BACKOFF_GROWTH, emptyPollCount)),
      );
    }

    if (body.terminal) {
      // Final synthetic done so the consumer knows we're finished.
      // The agent loop emitted its own done event with full meta;
      // if that one was already in body.events above, we don't
      // double-emit because translateEvent will have produced it.
      const sawDone = body.events.some((e) => e.event === "done");
      if (!sawDone) {
        // Failed/interrupted/timeout terminals may not have a done
        // event — emit one so consumer state transitions.
        onEvent({
          type: "done",
          duration_ms: body.duration_ms ?? Date.now() - startedAt,
        });
      }
      return { turnId };
    }

    await sleep(interval);
  }
}

/**
 * Translate a stored event row into the SSE-compatible ChatEvent
 * shape the consumer (ChatProvider's applyEvent) already knows.
 * One-to-one with chatStream.ts's parseFrame translations — same
 * event names, same payload field expectations.
 */
function translateEvent(ev: PollEvent): ChatEvent | null {
  const p = ev.payload || {};
  switch (ev.event) {
    case "session":
      return {
        type: "session",
        session_id: String(p.session_id ?? ""),
      };
    case "thought":
      return { type: "thought", text: String(p.text ?? "") };
    case "tool_call":
      return {
        type: "tool_call",
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        agent: (p.agent as string) ?? null,
      };
    case "tool_result":
      return {
        type: "tool_result",
        id: String(p.id ?? ""),
        preview: String(p.preview ?? ""),
        is_error: Boolean(p.is_error),
      };
    case "text_delta":
      return { type: "text_delta", content: String(p.content ?? "") };
    case "artifact":
      return {
        type: "artifact",
        kind: String(p.type ?? ""),
        title: (p.title as string) ?? null,
        content: p.content,
      };
    case "done":
      return {
        type: "done",
        duration_ms: Number(p.duration_ms ?? 0),
        cost_usd:
          p.cost_usd !== undefined ? Number(p.cost_usd) : undefined,
      };
    case "error":
      return {
        type: "error",
        message: String(p.message ?? "unknown error"),
      };
    default:
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tell the server to cancel an in-flight turn. Best effort —
 * the server's task.cancel() may take a moment to propagate.
 * The client stops polling immediately regardless.
 */
export async function cancelTurn(turnId: number): Promise<void> {
  try {
    await fetch(`/api/turns/${turnId}/cancel`, {
      method: "POST",
      cache: "no-store",
    });
  } catch {
    // best effort; client-side abort is what actually stops the UX
  }
}
