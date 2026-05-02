"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./share.module.css";

/**
 * /settings/share — pair an iOS device with Astra.
 *
 * Flow:
 *   1. Tap "generate token" — backend mints a one-time-display secret.
 *   2. Token is shown once (and only once) with a copy button.
 *   3. On your phone, open AstraShare, paste the token, hit Pair.
 *   4. Revoke any device from the list below. Revoked tokens 401 on
 *      their next /api/share POST.
 */

interface TokenRow {
  id: number;
  device_label: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

export default function ShareSettingsPage() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [label, setLabel] = useState("iPhone");
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/share/tokens", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setRows(body.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mint = async () => {
    setErr(null);
    setNewToken(null);
    setCopied(false);
    setBusy(true);
    try {
      const r = await fetch("/api/share/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_label: label }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setNewToken(body.token);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const revoke = async (id: number) => {
    if (!confirm("Revoke this device?")) return;
    try {
      await fetch(`/api/share/tokens/${id}/revoke`, { method: "POST" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">astra</Link>
          <span className={styles.trailArrow}>›</span>
          <span className={styles.trailCurrent}>settings / share</span>
        </div>
        <div className={styles.trailRight}>
          {rows.filter((r) => r.status === "active").length} paired
        </div>
      </div>

      <header className={styles.head}>
        <div className={styles.kicker}>share · iOS</div>
        <h1 className={styles.title}>let your phone reach in</h1>
        <div className={styles.sub}>
          Pair the AstraShare iOS app so tapping Share → Astra in any app
          (WhatsApp, Safari, Notes) drops the content straight into Astra.
          It becomes a task, memory, or meeting input automatically.
        </div>
      </header>

      {err ? <div className={styles.err}>{err}</div> : null}

      <section className={styles.mint}>
        <div className={styles.sectionLabel}>generate token</div>
        <div className={styles.mintRow}>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="device label"
            className={styles.input}
            disabled={busy}
          />
          <button
            className={styles.mintBtn}
            onClick={mint}
            disabled={busy || !label.trim()}
          >
            {busy ? "…" : "generate"}
          </button>
        </div>
        {newToken ? (
          <div className={styles.tokenBox}>
            <div className={styles.tokenLabel}>
              Copy this token and paste into AstraShare → Pairing.
              It won&rsquo;t be shown again.
            </div>
            <pre className={styles.token}>{newToken}</pre>
            <button className={styles.copyBtn} onClick={copy}>
              {copied ? "copied" : "copy"}
            </button>
          </div>
        ) : null}
      </section>

      <section className={styles.list}>
        <div className={styles.sectionLabel}>paired devices</div>
        {rows.length === 0 ? (
          <div className={styles.empty}>no devices paired yet.</div>
        ) : null}
        {rows.map((r) => (
          <article
            key={r.id}
            className={
              r.status === "active"
                ? styles.row
                : r.status === "revoked"
                  ? styles.rowRevoked
                  : styles.row
            }
          >
            <div className={styles.rowHead}>
              <span className={styles.rowLabel}>{r.device_label}</span>
              <span className={styles[`st_${r.status}`] ?? styles.stDefault}>
                {r.status}
              </span>
            </div>
            <div className={styles.rowMeta}>
              <span>created {fmtDate(r.created_at)}</span>
              <span className={styles.dot}>·</span>
              <span>
                last used {r.last_used_at ? fmtDate(r.last_used_at) : "never"}
              </span>
              {r.revoked_at ? (
                <>
                  <span className={styles.dot}>·</span>
                  <span>revoked {fmtDate(r.revoked_at)}</span>
                </>
              ) : null}
            </div>
            {r.status === "active" ? (
              <button
                className={styles.revoke}
                onClick={() => revoke(r.id)}
              >
                revoke
              </button>
            ) : null}
          </article>
        ))}
      </section>

      <section className={styles.how}>
        <div className={styles.sectionLabel}>how to pair</div>
        <ol className={styles.steps}>
          <li>
            Build + install <strong>AstraShare</strong> on your iPhone (see{" "}
            <code>~/Claude Code/astra-ios/README.md</code>).
          </li>
          <li>Open the Astra app on your phone.</li>
          <li>Generate a token above, copy it.</li>
          <li>In the Astra app, paste under <strong>Pairing</strong>, tap <strong>Pair this device</strong>.</li>
          <li>Tap <strong>Send test share</strong> to verify the round-trip.</li>
        </ol>
      </section>
    </main>
  );
}
