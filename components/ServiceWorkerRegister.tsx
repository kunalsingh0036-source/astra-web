"use client";

import { useEffect } from "react";

/**
 * Registers /astra-sw.js on first mount. Idempotent — the browser
 * upgrades the SW automatically if the file has changed. Separating
 * this from usePushSubscribe lets any page receive pushes without
 * having to visit /settings/notifications first.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // register on next tick so we don't block initial paint
    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register("/astra-sw.js", { scope: "/" })
        .catch(() => {
          // Silent — if SW install fails, the app still works. The
          // settings page surfaces the error explicitly.
        });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
