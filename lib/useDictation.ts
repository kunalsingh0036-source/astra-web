"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useDictation — Web Speech API dictation with a usable UX.
 *
 * Design goals (v2, after the first cut felt clunky):
 *
 *   1. Toggle-to-talk, not press-and-hold. One click to start, one to
 *      stop. Works even when the input already has text — dictation
 *      appends to whatever is there rather than blocking typing.
 *
 *   2. Silence auto-stop. If no speech is detected for
 *      `silenceTimeoutMs` (default 4s), recording stops cleanly —
 *      matches what people expect from voice-note style capture.
 *
 *   3. Auto-restart. Chrome's webkitSpeechRecognition cuts the
 *      session after ~60s of silence or on some network hiccups. We
 *      restart transparently while `listening` is true so one tap =
 *      one continuous dictation session from the user's point of
 *      view.
 *
 *   4. Never lose final text. If the session ends while interim text
 *      is still buffered, the latest interim gets promoted to final
 *      before we emit the stop state.
 *
 *   5. Explicit lang. Default en-US — webkitSpeechRecognition's
 *      Indian-English model is noticeably weaker for code-switching
 *      English, which is how most of India actually speaks. Caller
 *      can override.
 */

type Listener = (text: string) => void;

interface Options {
  onInterim?: Listener;
  onFinal?: Listener;
  onError?: (message: string) => void;
  /** BCP-47 language tag. Defaults to "en-US". */
  lang?: string;
  /** Stop recording after this many ms without a new result. 0 disables. */
  silenceTimeoutMs?: number;
}

interface SRConstructor {
  new (): SpeechRecognition;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

function getConstructor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(options: Options = {}) {
  const { onInterim, onFinal, onError, lang, silenceTimeoutMs = 4000 } = options;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  // Refs for long-lived state so callbacks don't re-bind every render.
  const recRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterimRef = useRef("");

  const interimRef = useRef<Listener | undefined>(onInterim);
  const finalRef = useRef<Listener | undefined>(onFinal);
  const errorRef = useRef<((m: string) => void) | undefined>(onError);
  useEffect(() => {
    interimRef.current = onInterim;
    finalRef.current = onFinal;
    errorRef.current = onError;
  }, [onInterim, onFinal, onError]);

  useEffect(() => {
    setSupported(Boolean(getConstructor()));
  }, []);

  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const scheduleSilence = useCallback(() => {
    clearSilence();
    if (silenceTimeoutMs <= 0) return;
    silenceTimerRef.current = setTimeout(() => {
      // User went quiet — commit any pending interim and stop.
      wantListeningRef.current = false;
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
    }, silenceTimeoutMs);
  }, [clearSilence, silenceTimeoutMs]);

  const boot = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) {
      errorRef.current?.("speech recognition not supported in this browser");
      wantListeningRef.current = false;
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = lang ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0].transcript;
        if (r.isFinal) final += t;
        else interim += t;
      }
      if (interim) {
        lastInterimRef.current = interim;
        interimRef.current?.(interim);
        scheduleSilence();
      }
      if (final) {
        lastInterimRef.current = "";
        finalRef.current?.(final.trim());
        scheduleSilence();
      }
    };

    rec.onerror = (event) => {
      const code = event.error;
      // "no-speech" is frequent when silence triggers the browser's
      // own end — swallow. "aborted" is us calling stop(). Anything
      // else we surface.
      if (code === "no-speech" || code === "aborted") return;
      // "not-allowed" means mic permission denied — stop trying.
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantListeningRef.current = false;
        errorRef.current?.(
          "microphone permission denied — enable in browser settings",
        );
        return;
      }
      errorRef.current?.(code);
    };

    rec.onend = () => {
      recRef.current = null;
      clearSilence();
      // Promote any lingering interim to final before stopping — so
      // the user's last words aren't lost when the browser ends the
      // session on its own.
      if (lastInterimRef.current) {
        finalRef.current?.(lastInterimRef.current.trim());
        lastInterimRef.current = "";
      }
      // Browsers auto-end the session after silence; if the user
      // still wants to be listening, transparently restart.
      if (wantListeningRef.current) {
        try {
          boot();
        } catch {
          wantListeningRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    try {
      rec.start();
      recRef.current = rec;
      scheduleSilence();
    } catch (e) {
      errorRef.current?.(e instanceof Error ? e.message : "failed to start");
      recRef.current = null;
      wantListeningRef.current = false;
      setListening(false);
    }
  }, [clearSilence, lang, scheduleSilence]);

  const start = useCallback(() => {
    if (wantListeningRef.current) return;
    wantListeningRef.current = true;
    setListening(true);
    lastInterimRef.current = "";
    boot();
  }, [boot]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    clearSilence();
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }, [clearSilence]);

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop();
    else start();
  }, [start, stop]);

  // Safety: abort on unmount.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearSilence();
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, [clearSilence]);

  return { supported, listening, start, stop, toggle };
}
