/**
 * Chat stream — client-side consumer of /api/chat SSE.
 *
 * The browser's built-in EventSource only supports GET, so we use a
 * streaming fetch() and parse SSE frames ourselves. This also gives
 * us full control over aborting mid-stream (e.g. user presses Esc).
 */

export type ChatEvent =
  | { type: "session"; session_id: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; name: string; agent: string | null }
  | { type: "tool_result"; id: string; preview: string; is_error: boolean }
  | { type: "text_delta"; content: string }
  | { type: "artifact"; kind: string; title: string | null; content: unknown }
  | {
      type: "done";
      duration_ms: number;
      cost_usd?: number;
      input_tokens?: number;
      output_tokens?: number;
    }
  | { type: "error"; message: string };

export interface StartStreamOptions {
  prompt: string;
  /** Session to resume — multi-turn. Omit for a fresh conversation. */
  sessionId?: string | null;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}

/**
 * Start a chat stream. Returns when the stream is complete (done
 * event received, connection closed, or aborted).
 */
export async function startChatStream({
  prompt,
  sessionId,
  signal,
  onEvent,
}: StartStreamOptions): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `HTTP ${res.status}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines (\n\n).
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseFrame(frame);
      if (parsed) onEvent(parsed);
      sep = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Parse one SSE frame:
 *   event: thought
 *   data: {"text":"..."}
 *
 * Comment frames (`: heartbeat`) are ignored. Unknown events are
 * dropped silently — we prefer graceful degradation over crashes.
 */
function parseFrame(frame: string): ChatEvent | null {
  const trimmed = frame.trimStart();
  if (!trimmed || trimmed.startsWith(":")) return null;

  let name = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      name = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }

  switch (name) {
    case "session":
      return { type: "session", session_id: String(data.session_id ?? "") };
    case "thought":
      return { type: "thought", text: String(data.text ?? "") };
    case "tool_call":
      return {
        type: "tool_call",
        id: String(data.id ?? ""),
        name: String(data.name ?? ""),
        agent: (data.agent as string) ?? null,
      };
    case "tool_result":
      return {
        type: "tool_result",
        id: String(data.id ?? ""),
        preview: String(data.preview ?? ""),
        is_error: Boolean(data.is_error),
      };
    case "text_delta":
      return { type: "text_delta", content: String(data.content ?? "") };
    case "artifact":
      return {
        type: "artifact",
        kind: String(data.type ?? ""),
        title: (data.title as string) ?? null,
        content: data.content,
      };
    case "done":
      return {
        type: "done",
        duration_ms: Number(data.duration_ms ?? 0),
        cost_usd: data.cost_usd !== undefined ? Number(data.cost_usd) : undefined,
        input_tokens:
          data.input_tokens !== undefined ? Number(data.input_tokens) : undefined,
        output_tokens:
          data.output_tokens !== undefined ? Number(data.output_tokens) : undefined,
      };
    case "error":
      return { type: "error", message: String(data.message ?? "unknown error") };
    default:
      return null;
  }
}
