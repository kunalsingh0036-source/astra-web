"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Web Push subscribe hook — manages service worker registration +
 * PushManager subscription + backend registration as one unit.
 *
 * The iOS caveat: `Notification.permission` + `PushManager.subscribe`
 * only become available *after* the page is added to the home screen
 * as a PWA. In Safari tab they silently fail. `.supported` below
 * reflects that distinction.
 */

type State =
  | "loading"
  | "unsupported"
  | "denied"
  | "not-subscribed"
  | "subscribed"
  | "error";

interface Hook {
  state: State;
  error: string | null;
  publicKey: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  sendTest: () => Promise<string | null>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePushSubscribe(): Hook {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        // Re-register every mount so we always pick up the latest sw.js
        // during development. In production the registration is stable
        // and this is a fast no-op.
        const reg = await navigator.serviceWorker.register("/astra-sw.js", {
          scope: "/",
        });
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setState("subscribed");
        } else if (Notification.permission === "denied") {
          setState("denied");
        } else {
          setState("not-subscribed");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    if (!VAPID_PUBLIC_KEY) {
      setError("VAPID public key not configured");
      setState("error");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "not-subscribed");
          return;
        }
      } else if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // TS 5.7+ narrowed `BufferSource` to exclude SharedArrayBuffer-
        // backed views, while `Uint8Array` defaults to
        // `Uint8Array<ArrayBufferLike>` which includes the shared
        // case. Our urlBase64ToUint8Array() allocates a fresh
        // ArrayBuffer (`new Uint8Array(len)`) so this is safe at
        // runtime. Cast to BufferSource at the boundary.
        applicationServerKey: urlBase64ToUint8Array(
          VAPID_PUBLIC_KEY,
        ) as BufferSource,
      });
      const raw = sub.toJSON() as {
        endpoint: string;
        keys?: { p256dh: string; auth: string };
      };

      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: raw.endpoint,
          p256dh: raw.keys?.p256dh,
          auth: raw.keys?.auth,
          user_agent: navigator.userAgent,
          device_label: inferDeviceLabel(),
        }),
      });
      if (!r.ok) throw new Error(`register failed: HTTP ${r.status}`);
      setState("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("not-subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  const sendTest = useCallback(async () => {
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      if (!r.ok) return `HTTP ${r.status}`;
      const body = await r.json();
      return body.detail || `sent to ${body.delivered ?? 0}`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, []);

  return {
    state,
    error,
    publicKey: VAPID_PUBLIC_KEY || null,
    subscribe,
    unsubscribe,
    sendTest,
  };
}

function inferDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) {
    if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Mac Safari";
    if (/Chrome/.test(ua)) return "Mac Chrome";
    return "Mac";
  }
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "browser";
}
