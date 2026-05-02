"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./memory.module.css";

/**
 * /memory — Astra's memory library.
 *
 * Client component because the filter chips + live search feel
 * better when interactive without a round-trip. Server route
 * `/api/memory` does the DB work.
 */

interface MemoryItem {
  id: number;
  content: string;
  type: "episodic" | "semantic" | "procedural" | "working" | string;
  source: string;
  tags: string | null;
  importance: number;
  access_count: number;
  created_at: string;
  /** Only present on semantic-search results. */
  similarity?: number;
}

interface MemoryResponse {
  total: number;
  by_type: Record<string, number>;
  items: MemoryItem[];
}

interface SearchResponse {
  query: string;
  count: number;
  items: MemoryItem[];
}

type TypeFilter = "all" | "episodic" | "semantic" | "procedural" | "working";
type SearchMode = "keyword" | "semantic";

export default function MemoryPage() {
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [semanticItems, setSemanticItems] = useState<MemoryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Base list — loads whenever the type filter changes. Always lives in
  // `data` so the sidebar counts stay accurate even while semantic
  // search is driving the result pane.
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);

    const url =
      filter === "all"
        ? "/api/memory?limit=100"
        : `/api/memory?type=${filter}&limit=100`;

    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as MemoryResponse;
      })
      .then((body) => {
        if (aborted) return;
        setData(body);
      })
      .catch((e: unknown) => {
        if (aborted) return;
        setError(e instanceof Error ? e.message : "failed to load");
      })
      .finally(() => {
        if (aborted) return;
        setLoading(false);
      });

    return () => {
      aborted = true;
    };
  }, [filter]);

  // Semantic search — debounced so we don't hit the embedding model on
  // every keystroke. Kicks in only when mode === "semantic" and the
  // query is non-empty.
  useEffect(() => {
    if (searchMode !== "semantic") {
      setSemanticItems(null);
      return;
    }
    const q = query.trim();
    if (!q) {
      setSemanticItems(null);
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "30" });
        if (filter !== "all") params.set("type", filter);
        const r = await fetch(`/api/memory?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as SearchResponse;
        if (!aborted) setSemanticItems(body.items);
      } catch (e) {
        if (!aborted && !(e instanceof Error && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : "search failed");
        }
      }
    }, 250);

    return () => {
      aborted = true;
      controller.abort();
      clearTimeout(handle);
    };
  }, [query, filter, searchMode]);

  const items = useMemo(() => {
    // Semantic mode wins when active and we have results.
    if (searchMode === "semantic") {
      if (!query.trim()) return data?.items ?? [];
      return semanticItems ?? [];
    }

    // Keyword mode — client-side contains-match over the loaded page.
    if (!data) return [];
    if (!query.trim()) return data.items;
    const q = query.toLowerCase();
    return data.items.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        (m.tags ?? "").toLowerCase().includes(q),
    );
  }, [data, query, searchMode, semanticItems]);

  const total = data?.total ?? 0;

  return (
    <main className={styles.main}>
      <header className={styles.trail}>
        <div className={styles.trailLeft}>
          <Link href="/">canvas</Link>
          <span className={styles.trailArrow}>/</span>
          <span className={styles.trailCurrent}>memory</span>
        </div>
        <div className={styles.trailRight}>
          {!loading && !error && <span>{total} items · pgvector</span>}
          {loading && <span>loading…</span>}
          {error && <span className={styles.errText}>error · {error}</span>}
        </div>
      </header>

      <section className={styles.head}>
        <div className={styles.kicker}>
          memory · recall · live from astra&apos;s long-term store
        </div>
        <h1 className={styles.title}>what I remember.</h1>
        {data && (
          <p className={styles.summary}>
            <em>{total.toLocaleString()}</em>{" "}
            {total === 1 ? "thing" : "things"} worth keeping.{" "}
            {Object.entries(data.by_type).length > 0 && (
              <>
                {Object.entries(data.by_type)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(" · ")}
                .
              </>
            )}
          </p>
        )}
      </section>

      <section className={styles.controls}>
        <div className={styles.searchBar}>
          <span className={styles.searchPrompt}>⌕</span>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              searchMode === "semantic"
                ? "ask in natural language — pgvector similarity"
                : "filter by keyword or tag"
            }
            aria-label="Memory search"
          />
          <div className={styles.modeToggle} role="tablist" aria-label="Search mode">
            <button
              type="button"
              role="tab"
              aria-selected={searchMode === "keyword"}
              className={`${styles.modeBtn} ${searchMode === "keyword" ? styles.modeActive : ""}`}
              onClick={() => setSearchMode("keyword")}
            >
              keyword
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={searchMode === "semantic"}
              className={`${styles.modeBtn} ${searchMode === "semantic" ? styles.modeActive : ""}`}
              onClick={() => setSearchMode("semantic")}
            >
              semantic
            </button>
          </div>
        </div>
        <div className={styles.filters}>
          {(["all", "episodic", "semantic", "procedural", "working"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.filter} ${filter === t ? styles.active : ""}`}
              onClick={() => setFilter(t)}
            >
              {t}
              {data && t !== "all" && data.by_type[t] !== undefined && (
                <span className={styles.filterCount}>{data.by_type[t]}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.list}>
        {items.length === 0 && !loading && (
          <p className={styles.empty}>
            {data ? "Nothing matches — try a different keyword." : "Loading…"}
          </p>
        )}

        {items.map((m) => (
          <article key={m.id} className={styles.item}>
            <div className={styles.itemTop}>
              <span className={`${styles.itemType} ${styles[`type_${m.type}`]}`}>
                {m.type}
              </span>
              {m.similarity !== undefined && (
                <span className={styles.itemSim} title="cosine similarity">
                  {(m.similarity * 100).toFixed(0)}% match
                </span>
              )}
              <span className={styles.itemTime}>{formatTime(m.created_at)}</span>
            </div>
            <div className={styles.itemBody}>{m.content}</div>
            <footer className={styles.itemMeta}>
              <span>
                source · <b>{m.source}</b>
                {m.tags && (
                  <>
                    {" · "}
                    <span className={styles.tags}>{m.tags}</span>
                  </>
                )}
              </span>
              <span className={styles.imp}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={`${styles.impDot} ${
                      i < Math.round(m.importance * 5) ? styles.impOn : ""
                    }`}
                  />
                ))}
              </span>
            </footer>
          </article>
        ))}
      </section>
    </main>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return `${Math.max(1, Math.round(diffMs / 60_000))}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
  return d
    .toLocaleDateString("en-US", { day: "2-digit", month: "short" })
    .toLowerCase();
}
