"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Astra's voice. Primary path: POST /api/tts → ElevenLabs (River),
 * played through an <audio> element — a real, consistent voice, the
 * same one Astra uses on WhatsApp voice replies. Fallback path: the
 * browser's window.speechSynthesis, so if the TTS service is down or
 * unconfigured the button still works (robotic but never silent).
 *
 * speak() toggles: tap to play, tap again to stop.
 */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Either path makes us "supported": real TTS is server-side
    // (always worth trying), browser TTS is the floor.
    setSupported(typeof window !== "undefined");
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAll() {
    if (typeof window === "undefined") return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  const stop = useCallback(() => {
    stopAll();
    setSpeaking(false);
  }, []);

  const _browserFallback = useCallback((clean: string) => {
    if (!("speechSynthesis" in window)) {
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.05;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!supported || !text.trim()) return;
      // Toggle off if already playing.
      if (speaking) {
        stopAll();
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

      setSpeaking(true);
      // Primary: Astra's real voice via /api/tts.
      try {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (r.ok && r.headers.get("content-type")?.includes("audio")) {
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            setSpeaking(false);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            _browserFallback(clean); // last resort
          };
          await audio.play();
          return;
        }
        // Non-audio response (503 unconfigured / 502) → fallback.
        _browserFallback(clean);
      } catch {
        _browserFallback(clean);
      }
    },
    [supported, speaking, _browserFallback],
  );

  return { supported, speaking, speak, stop };
}
