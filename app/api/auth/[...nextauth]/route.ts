// NextAuth catch-all — the library's handler object contains GET + POST.
// Must be no-cache because it handles live OAuth callback redirects.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
export const dynamic = "force-dynamic";
