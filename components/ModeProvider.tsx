"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Mode } from "@/lib/types";

/**
 * Adaptive density modes.
 *
 * Monastic    — one thing at a time, maximal whitespace
 * Editorial   — magazine-spread default
 * Ops         — information-rich, trader-terminal
 *
 * The user can override with ⌘1 / ⌘2 / ⌘3. A ModeProvider sits at
 * the root so any component can read or change the active mode, and
 * the current value is reflected on the <html> element via a
 * `data-density` attribute for any CSS that cares.
 */

interface ModeContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("editorial");

  useEffect(() => {
    document.documentElement.setAttribute("data-density", mode);
  }, [mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "1") {
        e.preventDefault();
        setMode("monastic");
      } else if (e.key === "2") {
        e.preventDefault();
        setMode("editorial");
      } else if (e.key === "3") {
        e.preventDefault();
        setMode("ops");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used inside <ModeProvider>");
  return ctx;
}
