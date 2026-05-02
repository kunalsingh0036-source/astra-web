/**
 * NextAuth v5 configuration.
 *
 * Single-user auth: only kunalsingh0036@gmail.com (the domain owner)
 * can sign in. All other Google accounts are refused. Session cookies
 * are signed with AUTH_SECRET and scoped to the root domain so they
 * work across all astra.thearrogantclub.com subdomains.
 *
 * The middleware in middleware.ts enforces that every non-public path
 * requires a valid session.
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// The single email allowed to sign in. Anyone else sees "access denied".
const ALLOWED_EMAILS = new Set([
  "kunalsingh0036@gmail.com",
]);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  // Reject sign-in for any account not on the allow-list.
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email || !ALLOWED_EMAILS.has(email)) {
        return false;
      }
      return true;
    },
    async session({ session, token }) {
      // Forward user id onto the session object so server components
      // can read it without re-parsing the token.
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  // Custom sign-in page uses our design system rather than NextAuth's default.
  pages: {
    signIn: "/signin",
    error: "/signin",
  },

  // 30-day rolling session — long enough that you don't re-auth daily
  // on your phone, short enough that a lost device can be invalidated
  // by rotating AUTH_SECRET.
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },

  secret: process.env.AUTH_SECRET,

  // Trust the host header when behind Cloudflare Tunnel / reverse proxies.
  trustHost: true,
});
