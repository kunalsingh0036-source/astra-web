/**
 * Auth middleware.
 *
 * Every request is authenticated by default. The only public paths
 * are /signin (the custom sign-in page) and /api/auth/* (NextAuth's
 * own endpoints — sign-in callback, sign-out, etc).
 *
 * Additionally, requests that carry the shared secret header are
 * allowed through unauthenticated. This is how the Cloudflare-tunneled
 * email/whatsapp webhook endpoints let Google Pub/Sub and Meta reach
 * us without an OAuth flow.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PREFIXES = [
  "/signin",
  "/api/auth",
  // Next.js internals — fonts, images, hot reload
  "/_next",
  "/favicon.svg",
  "/wordmark.svg",
  "/agent-glyphs.svg",
  // The service worker must be fetchable without a session — browsers
  // load it before any auth cookie is attached.
  "/astra-sw.js",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?") || pathname === p);
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Public paths pass through unchanged.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Server-to-server callers provide the shared secret. This lets our
  // scheduler poll state endpoints and lets webhooks reach API routes.
  const shared = process.env.ASTRA_SHARED_SECRET;
  const provided = req.headers.get("x-astra-secret");
  if (shared && provided && provided === shared) {
    return NextResponse.next();
  }

  // iOS Share Sheet pairing — the AstraShare extension hits
  // /api/share with a Bearer token from share_tokens. The route
  // handler validates the token; middleware just lets it through.
  // Restricted to the exact `/api/share` path (NOT /api/share/tokens
  // which is admin-only and stays auth-gated).
  if (
    pathname === "/api/share" &&
    (req.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ")
  ) {
    return NextResponse.next();
  }

  // Already signed in — allow.
  if (req.auth) {
    return NextResponse.next();
  }

  // Block API calls with 401 (curl / fetch get a clean error).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Page request — bounce to sign-in, preserving return URL.
  const signIn = new URL("/signin", nextUrl.origin);
  signIn.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
  return NextResponse.redirect(signIn);
});

// Run middleware on everything EXCEPT static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
