"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./settings.module.css";

/**
 * /settings — hub for Astra's user-facing controls.
 *
 * The previous /settings route 404'd despite being referenced from the
 * command palette and other places. This page is the canonical landing
 * for any user-tweakable Astra config: autonomy mode, notifications,
 * shared devices, etc.
 *
 * The autonomy-mode picker is the headline control because it directly
 * shapes how every chat turn behaves (what auto-runs vs what asks).
 * Mode changes hit /api/autonomy which writes to a file astra-stream
 * reads on every turn, so the change is live immediately.
 */

type Mode = "always_ask" | "semi_auto" | "full_auto";

interface ModeOption {
  mode: Mode;
  title: string;
  description: string;
  example: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: "always_ask",
    title: "always ask",
    description:
      "Every tool requires your explicit approval. Safest. Best when you're learning Astra's behavior or working on sensitive tasks.",
    example:
      "Astra wants to read a brand kit file? Ask. Send an email? Ask. Web fetch? Ask.",
  },
  {
    mode: "semi_auto",
    title: "semi auto",
    description:
      "Read-only actions auto-approve. Writes (file edits, sends, mutations) still need approval. Default. Best for daily work.",
    example:
      "File reads + searches auto-run. Sending an email or editing a kit asks first.",
  },
  {
    mode: "full_auto",
    title: "full auto",
    description:
      "Every action executes immediately. Audit trail records all of it. Fastest. Best for trusted overnight runs.",
    example:
      "No prompts. Astra researches, edits, sends. Read /audit afterward to see what happened.",
  },
];

export default function SettingsPage() {
  const [currentMode, setCurrentMode] = useState<Mode | null>(null);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMode = useCallback(async () => {
    try {
      const res = await fetch("/api/autonomy", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { mode?: Mode };
      if (body.mode) setCurrentMode(body.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load mode");
    }
  }, []);

  useEffect(() => {
    void loadMode();
  }, [loadMode]);

  async function chooseMode(mode: Mode) {
    if (mode === currentMode || pendingMode) return;
    setPendingMode(mode);
    setError(null);
    try {
      const res = await fetch("/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = (await res.json()) as {
        mode?: Mode;
        error?: string;
      };
      if (!res.ok || body.error) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setCurrentMode(body.mode ?? mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save mode");
    } finally {
      setPendingMode(null);
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>settings</span>
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          settings · how astra behaves
        </div>
        <h1 className={styles.title}>your astra, dialed in.</h1>
        {error && <p className={styles.errText}>error · {error}</p>}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>autonomy mode</h2>
          <p className={styles.sectionMeta}>
            controls when astra asks vs runs · changes apply on the
            very next turn, no restart
          </p>
        </div>
        <div className={styles.modeGrid}>
          {MODE_OPTIONS.map((opt) => {
            const active = currentMode === opt.mode;
            const loading = pendingMode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                className={`${styles.modeCard} ${active ? styles.modeActive : ""}`}
                onClick={() => chooseMode(opt.mode)}
                disabled={loading || (!!pendingMode && !loading)}
                aria-pressed={active}
              >
                <div className={styles.modeCardHead}>
                  <span className={styles.modeName}>{opt.title}</span>
                  {active && <span className={styles.modeBadge}>current</span>}
                  {loading && <span className={styles.modeBadge}>saving…</span>}
                </div>
                <p className={styles.modeDesc}>{opt.description}</p>
                <p className={styles.modeExample}>
                  <em>e.g.</em> {opt.example}
                </p>
              </button>
            );
          })}
        </div>
        <p className={styles.modeHint}>
          You can also change this from the command palette (⌘K → search
          &quot;mode&quot;), the audit page, or by saying / typing
          <em> &quot;switch to semi-auto&quot; </em> to astra in chat.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>more</h2>
          <p className={styles.sectionMeta}>
            other corners of astra you might want to configure
          </p>
        </div>
        <ul className={styles.subList}>
          <li>
            <Link href="/settings/notifications" className={styles.subLink}>
              <span className={styles.subTitle}>notifications</span>
              <span className={styles.subDesc}>
                briefings · task reminders · web push subscriptions
              </span>
            </Link>
          </li>
          <li>
            <Link href="/settings/share" className={styles.subLink}>
              <span className={styles.subTitle}>shared devices</span>
              <span className={styles.subDesc}>
                pair iOS · revoke tokens · manage AstraShare devices
              </span>
            </Link>
          </li>
          <li>
            <Link href="/audit" className={styles.subLink}>
              <span className={styles.subTitle}>audit trail</span>
              <span className={styles.subDesc}>
                every tool decision, every approval, with mode at the time
              </span>
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
