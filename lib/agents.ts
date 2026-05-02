/**
 * Fleet roster — mock agent state until we wire up the A2A bridge.
 *
 * Each agent's orbit parameters were hand-tuned so the canvas doesn't
 * look mechanical: non-harmonic periods, staggered starting angles,
 * mixed orbit directions. This is the source of the "alive" feel.
 */

import type { Agent } from "./types";

export const FLEET: Agent[] = [
  {
    id: "email",
    label: "email",
    status: "pulsing",
    ring: 1,
    angle: 0,
    periodSec: 92,
    sizePx: 20,
    direction: 1,
    role: "inbox & drafting",
    port: 8005,
  },
  {
    id: "finance",
    label: "finance",
    status: "active",
    ring: 1,
    angle: 180,
    periodSec: 92,
    sizePx: 18,
    direction: 1,
    role: "invoices, cash, forecasting",
    port: 8004,
  },
  {
    id: "whatsapp",
    label: "whatsapp",
    status: "active",
    ring: 2,
    angle: 45,
    periodSec: 138,
    sizePx: 12,
    direction: -1,
    role: "messaging gateway",
    port: 8600,
  },
  {
    id: "linkedin",
    label: "linkedin",
    status: "active",
    ring: 2,
    angle: 165,
    periodSec: 138,
    sizePx: 14,
    direction: -1,
    role: "content & outreach",
    port: 8002,
  },
  {
    id: "bookkeeper",
    label: "bookkeeper",
    status: "dim",
    ring: 2,
    angle: 285,
    periodSec: 138,
    sizePx: 8,
    direction: -1,
    role: "ledger & reconciliation",
    port: 8000,
  },
  {
    id: "helmtech",
    label: "helmtech",
    status: "dim",
    ring: 3,
    angle: 30,
    periodSec: 184,
    sizePx: 8,
    direction: 1,
    role: "b2b outreach",
    port: 8003,
  },
  {
    id: "apex",
    label: "apex",
    status: "dim",
    ring: 3,
    angle: 210,
    periodSec: 184,
    sizePx: 8,
    direction: 1,
    role: "human outreach",
    port: 8001,
  },
];

/** Radii for the three orbital rings, in pixels. */
export const RING_RADII: Record<1 | 2 | 3, number> = {
  1: 140,
  2: 260,
  3: 410,
};
