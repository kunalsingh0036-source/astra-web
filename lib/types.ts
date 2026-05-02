/**
 * Core types shared across the Astra web app.
 *
 * These mirror the A2A protocol and the fleet agents. When we wire up
 * `astra-stream`, the same shapes flow through SSE events.
 */

export type AgentStatus = "active" | "idle" | "pulsing" | "dim" | "alarm";

export type AgentName =
  | "email"
  | "finance"
  | "whatsapp"
  | "linkedin"
  | "bookkeeper"
  | "helmtech"
  | "apex";

export interface Agent {
  /** Stable identifier used in A2A routing. */
  id: AgentName;
  /** Human-facing name shown in tooltips and glyph labels. */
  label: string;
  /** Current liveness — drives orb brightness on the canvas. */
  status: AgentStatus;
  /** 1 (closest) to 3 (farthest). Drives orbit radius. */
  ring: 1 | 2 | 3;
  /** Where on its orbit the agent currently sits (degrees). */
  angle: number;
  /** Orbital period in seconds. Slower = larger, more permanent feel. */
  periodSec: number;
  /** Orb diameter in pixels. Size encodes activity level. */
  sizePx: number;
  /** Whether the orbit runs clockwise (`1`) or counter-clockwise (`-1`). */
  direction: 1 | -1;
  /** One-line role description for tooltips. */
  role: string;
  /** Port the backing service listens on (dev / local). */
  port: number;
}

export type Mode = "monastic" | "editorial" | "ops";

export interface Message {
  role: "user" | "astra";
  content: string;
  timestamp: Date;
}
