import type { NextRequest } from "next/server";

/**
 * GET /api/email/digest — proxies to Astra's email signals.
 *
 * We don't query the astra DB directly here; email-agent is the source
 * of truth for messages. This route wraps a small direct call to
 * email-agent and computes the same digest the briefing uses.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Noise detection — see astra/email/signals.py for the canonical list.
// Kept in sync by eye; when we add entries in Python, mirror here.
const NOISE_LOCAL = [
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "donotrespond", "automated",
  "notification", "notifications",
  "alert", "alerts",
  "update", "updates",
  "news", "newsletter",
  "receipt", "receipts", "invoice", "billing",
  "marketing", "promo", "promotions", "offer", "offers",
  "campaign", "campaigns", "newcomers",
  "transaction", "transactions",
  "statements", "statement",
  "mailer", "mailers", "mail", "email",
  "info", "hello", "team", "support",
  "care", "customercare",
  "welcome", "onboarding",
  "account", "accounts",
  "emandates", "emandate",
  "instructor", "instructors",
  "sales",
];
const NOISE_DOMAIN = [
  "sbicard.com", "kotak.bank", "icicibank", "icici.bank",
  "hdfcbank", "hdfc.bank", "axisbank", "axis.bank",
  "yesbank", "yes.bank", "sbi.co", "sbi.bank", "bankalerts",
  "paytm.com", "phonepe.com", "gpay",
  "gst.gov.in", "incometax.gov.in",
  "facebookmail.com", "facebook.com", "meta.com",
  "linkedin.com", "linkedinmail",
  "slack.com", "medium.com", "substack.com",
  "github.com", "gitlab.com",
  "googleplay", "googlecommunity",
  "youtube.com", "youtu.be",
  "appleid.apple.com",
  "anthropic.com", "openai.com",
  "cloudflare.com", "notion.so", "figma.com",
  "booking.com", "airbnb.com",
  "spicejet.com", "web-spicejet", "indigo.in", "airindia",
  "mmt.mp.makemytrip", "makemytrip.com",
  "uber.com", "olacabs",
  "amazon.in", "amazon.com", "flipkart.com", "myntra.com",
  "reliancedigital", "relianceretail",
  "tata1mg", "emaila.1mg.com", "1mg.com",
  "swiggy.in", "zomato.com",
  "freeletics", "updates.freeletics", "xpandstore",
  "email.intch", "intch.org",
  "myhq.in",
  "sendgrid", "mailgun", "mailchimp",
];
const NOISE_SUB_PREFIX = [
  "updates.", "news.", "newsletter.", "email.", "mail.",
  "notifications.", "notify.", "alerts.", "info.", "marketing.",
  "campaigns.", "promo.", "offers.", "invoice.", "billing.",
  "account.", "accounts.", "noreply.", "support.",
];

function isNoise(addr: string): boolean {
  const s = (addr || "").toLowerCase();
  if (!s) return true;
  const m = s.match(/<([^>]+)>/);
  const emailPart = (m ? m[1] : s).trim();
  const [local, domain] = emailPart.includes("@")
    ? emailPart.split("@", 2)
    : [emailPart, ""];
  for (const p of NOISE_DOMAIN) if (domain.includes(p)) return true;
  for (const p of NOISE_SUB_PREFIX) if (domain.startsWith(p)) return true;
  for (const p of NOISE_LOCAL) if (local.includes(p)) return true;
  return false;
}

interface Message {
  id: string;
  gmail_message_id: string;
  direction: string;
  from_address: string;
  to_addresses: string[];
  subject: string;
  snippet: string | null;
  body_text: string | null;
  sent_at: string;
  is_read: boolean;
  ai_category: string | null;
  ai_priority: string | null;
  ai_summary: string | null;
  ai_action_needed: boolean | null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const windowHours = Math.max(
    1,
    Math.min(168, Number(url.searchParams.get("hours") ?? 24)),
  );
  const includeNoise = url.searchParams.get("noise") === "true";

  try {
    const upstream = await fetch(
      "http://localhost:8005/api/v1/messages/?direction=inbound&limit=200",
      { cache: "no-store" },
    );
    if (!upstream.ok) {
      return Response.json(
        { error: `email-agent ${upstream.status}` },
        { status: 502 },
      );
    }
    const messages: Message[] = await upstream.json();

    const cutoff = Date.now() - windowHours * 3600 * 1000;
    const inWindow = messages.filter((m) => {
      const t = Date.parse(m.sent_at || "");
      return Number.isFinite(t) && t >= cutoff;
    });
    const real = inWindow.filter((m) => !isNoise(m.from_address));
    const noise = inWindow.filter((m) => isNoise(m.from_address));
    const corpus = includeNoise ? inWindow : real;

    const unread = corpus.filter((m) => !m.is_read).length;
    const actionNeeded = corpus.filter((m) => m.ai_action_needed).length;
    const byCategory: Record<string, number> = {};
    for (const m of corpus) {
      const c = m.ai_category || "unclassified";
      byCategory[c] = (byCategory[c] || 0) + 1;
    }

    // Rank: unread first, then newest
    const ranked = [...real].sort((a, b) => {
      const au = a.is_read ? 0 : 1;
      const bu = b.is_read ? 0 : 1;
      if (au !== bu) return bu - au;
      return Date.parse(b.sent_at) - Date.parse(a.sent_at);
    });

    return Response.json({
      window_hours: windowHours,
      total_inbound: inWindow.length,
      real_inbound: real.length,
      noise_count: noise.length,
      unread,
      action_needed: actionNeeded,
      by_category: byCategory,
      notable: ranked.slice(0, 25).map((m) => ({
        id: m.id,
        gmail_message_id: m.gmail_message_id,
        from: m.from_address,
        subject: (m.subject || "").slice(0, 200),
        sent_at: m.sent_at,
        snippet: (m.snippet || m.body_text || "").slice(0, 280),
        is_read: !!m.is_read,
        action_needed: !!m.ai_action_needed,
        category: m.ai_category || "unclassified",
        priority: (m as Message & { ai_priority?: string | null }).ai_priority || "normal",
        ai_summary: (m as Message & { ai_summary?: string | null }).ai_summary || "",
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
