"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser text-to-speech (window.speechSynthesis). Zero-cost,
 * offline, instant — the right first cut for "let me HEAR Astra"
 * (hands-free at the desk, mid-task). If we ever want it to sound
 * like Astra specifically, swap the body for an API TTS call behind
 * the same speak()/stop() surface; nothing else changes.
 *
 * Strips markdown so the voice doesn't read "asterisk asterisk" and
 * code fences aloud.
 */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" && "speechSynthesis" in window,
    );
    // Cancel any in-flight speech if the component unmounts.
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      // Toggle: if already speaking, stop.
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
        return;
      }
      const clean = text
        .replace(/```[\s\S]*?```/g, " (code block) ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[*_#>]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\n{2,}/g, ". ")
        .trim();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.05;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      utterRef.current = u;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setSpeaking(true);
    },
    [supported],
  );

  return { supported, speaking, speak, stop };
}
