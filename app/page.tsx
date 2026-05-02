import { AmbientSignals } from "@/components/AmbientSignals";
import { Canvas } from "@/components/Canvas/Canvas";
import { InputLine } from "@/components/InputLine/InputLine";
import { ResponsePane } from "@/components/ResponsePane/ResponsePane";
import { ThoughtStream } from "@/components/ThoughtStream/ThoughtStream";
import { TopBar } from "@/components/TopBar/TopBar";
import styles from "./page.module.css";

// Force dynamic rendering. Next 16's static-gen requires every
// client component that uses useSearchParams() to be wrapped in
// <Suspense>; the chat canvas + InputLine read query params for
// session resume and several other things, and the build fails
// trying to prerender this page statically. Since the page is
// always dynamic anyway (auth gate, live SSE state, session
// resume) — pre-rendering it adds nothing — marking it dynamic
// sidesteps the suspense-boundary requirement on every nested
// useSearchParams caller.
export const dynamic = "force-dynamic";

/**
 * / — the root canvas view.
 *
 * Layers, from back to front:
 *   1. Starfield (body::before)
 *   2. Canvas — orbits + you-point; orbs burn crimson when an
 *      agent needs attention
 *   3. ThoughtStream — italic reasoning appears mid-canvas while
 *      Astra is thinking
 *   4. AmbientSignals — italic whispers at the top when something
 *      needs attention (overdue invoice, unread email, etc.).
 *      Silent when quiet.
 *   5. ResponsePane — Astra's final answer
 *   6. TopBar + InputLine — minimal chrome
 *   7. Signature — the quiet wordmark (rendered by RootLayout)
 */
export default function HomePage() {
  return (
    <main className={styles.root}>
      <TopBar />
      <Canvas />
      <AmbientSignals />
      <ThoughtStream />
      <ResponsePane />
      <InputLine />
    </main>
  );
}
