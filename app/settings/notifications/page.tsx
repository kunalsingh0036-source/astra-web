"use client";

import Link from "next/link";
import { useState } from "react";
import { usePushSubscribe } from "@/lib/usePushSubscribe";
import styles from "./notifications.module.css";

/**
 * /settings/notifications — enable / test / revoke Web Push.
 *
 * On iPhone this only works if Astra has been added to the home
 * screen (PWA mode). Safari in a regular tab cannot subscribe.
 */

export default function NotificationsSettingsPage() {
  const { state, error, subscribe, unsubscribe, sendTest } = usePushSubscribe();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await sendTest();
      setTestResult(r || "sent");
    } finally {
      setBusy(false);
    }
  };

  const label = {
    loading: "checking…",
    unsupported: "this browser can't do web push",
    denied: "notifications are blocked at the OS level",
    "not-subscribed": "not yet subscribed",
    subscribed: "subscribed",
    error: "error",
  }[state];

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>settings / notifications</span>
        </div>
        <div className={styles.trailRight}>{label}</div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>notifications</div>
        <h1 className={styles.title}>wake the phone</h1>
        <div className={styles.sub}>
          Lock-screen alerts when a briefing lands, a meeting summary is
          ready, or a human is waiting on you. Web Push — no native app
          required.
        </div>
      </header>

      {state === "unsupported" ? (
        <section className={styles.note}>
          This browser doesn&rsquo;t support Web Push. On iPhone, you need to{" "}
          <em>add Astra to your Home Screen</em> first (Safari share sheet →
          Add to Home Screen), then open it from the home icon and come back
          here.
        </section>
      ) : null}

      {state === "denied" ? (
        <section className={styles.note}>
          Notification permission is blocked. To re-enable: iPhone Settings →
          Astra → Notifications → Allow Notifications. Then refresh this page.
        </section>
      ) : null}

      {error ? <section className={styles.err}>{error}</section> : null}

      <section className={styles.actions}>
        {state === "not-subscribed" || state === "error" ? (
          <button onClick={subscribe} className={styles.primary} disabled={busy}>
            enable notifications
          </button>
        ) : null}
        {state === "subscribed" ? (
          <>
            <button
              onClick={runTest}
              className={styles.primary}
              disabled={busy}
            >
              {busy ? "…" : "send test notification"}
            </button>
            <button onClick={unsubscribe} className={styles.secondary}>
              unsubscribe this device
            </button>
          </>
        ) : null}
      </section>

      {testResult ? (
        <section className={styles.testOut}>{testResult}</section>
      ) : null}

      <section className={styles.expect}>
        <div className={styles.sectionLabel}>what you&rsquo;ll receive</div>
        <ul className={styles.list}>
          <li>
            <strong>12:45 IST · inbox preview</strong> — &ldquo;X people
            waiting&rdquo; right before your work window starts.
          </li>
          <li>
            <strong>21:30 IST · training catch-up</strong> — log the day&rsquo;s
            training against your Kunal note.
          </li>
          <li>
            <strong>22:00 IST · evening briefing</strong> — synthesized
            end-of-day read, compass-measured.
          </li>
          <li>
            <strong>Meeting summary ready</strong> — whenever a recording
            finishes transcription + Claude summary.
          </li>
          <li>
            <strong>Research briefing delivered</strong> — 07:00 IST on the
            rotating topic of the day.
          </li>
        </ul>
      </section>
    </main>
  );
}
