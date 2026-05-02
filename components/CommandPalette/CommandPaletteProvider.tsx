"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { CommandPalette } from "./CommandPalette";

/**
 * Command palette provider.
 *
 * Manages the open/closed state of the ⌘K overlay and listens for
 * the global hotkey. Any component can call `useCommandPalette().open()`
 * to summon it, but 99% of the time it's triggered by ⌘K.
 */

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K → toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
        return;
      }
      // Esc → close
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandPaletteContext.Provider
      value={{
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        isOpen,
      }}
    >
      {children}
      {isOpen && <CommandPalette onClose={() => setIsOpen(false)} />}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}
