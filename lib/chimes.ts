"use client";

/**
 * Astra's three subtle chimes. Designed to the manifesto:
 *   - briefing landed: low warm 220 Hz, 300 ms fade
 *   - task completed: single high soft 880 Hz, 150 ms
 *   - needs attention: paired tones, 5th interval, slightly dissonant
 *
 * Felt more than heard. Volume capped at -18 dB. Off by default —
 * toggled via `astraSoundOn()` / `astraSoundOff()`, persisted to
 * localStorage. Zero sounds play until the user opts in, so we're
 * silent on first load.
 */

type Chime = "briefing" | "task" | "attention";

const STORAGE_KEY = "astra:chimes";
const PEAK = 0.125; // ~ -18 dB

let ctx: AudioContext | null = null;

function ctxInstance(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  type Win = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as Win).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function isSoundOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "on";
}

export function astraSoundOn() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, "on");
  }
}

export function astraSoundOff() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, "off");
  }
}

/** Play a single tone for `ms` ms with a soft attack+release. */
function blip(
  c: AudioContext,
  freq: number,
  ms: number,
  peak: number = PEAK,
  offsetSec = 0,
  type: OscillatorType = "sine",
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const start = c.currentTime + offsetSec;
  const end = start + ms / 1000;

  // Curve: fast 20 ms attack, gentle linear release.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.setValueAtTime(peak, end - 0.06);
  gain.gain.linearRampToValueAtTime(0, end);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function playChime(kind: Chime) {
  if (!isSoundOn()) return;
  const c = ctxInstance();
  if (!c) return;
  // Resume suspended context (Safari/Chrome require user gesture).
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }

  switch (kind) {
    case "briefing":
      // Low, warm. One tone 300 ms.
      blip(c, 220, 300, PEAK, 0, "sine");
      break;
    case "task":
      // Single high soft chime, 150 ms.
      blip(c, 880, 150, PEAK * 0.85, 0, "sine");
      break;
    case "attention":
      // Paired tones, 5th interval, slightly dissonant. Second tone
      // lands 140 ms into the first.
      blip(c, 494, 260, PEAK, 0, "triangle"); // B4
      blip(c, 740, 260, PEAK * 0.8, 0.14, "triangle"); // ~F#5 (tritone-ish)
      break;
  }
}
