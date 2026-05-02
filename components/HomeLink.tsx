"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@/components/ChatProvider";

/**
 * The `astra` wordmark as a navigational affordance.
 *
 * Click anywhere this component lives (top-left of canvas, bottom-left
 * signature, or any page's trail) and you get back to the home canvas
 * with any in-flight conversation reset to its initial state.
 *
 * Rendered in two variants:
 *   - "mark"      : TopBar placement (20px italic serif)
 *   - "signature" : footer placement (handwritten feel)
 *
 * The variant controls the className so each caller can keep its own
 * CSS module ownership — HomeLink stays presentation-agnostic.
 */
export function HomeLink({
  className,
  label = "astra",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { reset } = useChat();

  function goHome(e: React.MouseEvent<HTMLAnchorElement>) {
    // Reset conversation regardless of where we are — going "home"
    // should feel like a clean canvas every time.
    reset();

    // If we're already on "/", let the default Link navigation be a no-op
    // (it still scrolls to top). No need to push.
    if (pathname === "/") {
      // Scroll to top in case a sub-view was scrolled.
      e.preventDefault();
      router.push("/");
    }
  }

  return (
    <Link href="/" onClick={goHome} className={className} aria-label="Return to canvas">
      {label}
    </Link>
  );
}
