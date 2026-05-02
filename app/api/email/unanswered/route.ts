import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keep in sync with astra/email/signals.py noise lists.
const NOISE_LOCAL = [
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "donotrespond", "automated", "notification", "notifications",
  "alert", "alerts", "update", "updates", "news", "newsletter",
  "receipt", "receipts", "invoice", "billing", "marketing", "promo",
  "promotions", "offer", "offers", "campaign", "campaigns", "newcomers",
  "transaction", "transactions", "statements", "statement",
  "mailer", "mailers", "mail", "email", "info", "hello", "team",
  "support", "care", "customercare", "welcome", "onboarding",
  "account", "accounts", "emandates", "emandate",
  "instructor", "instructors", "sales",
];
const NOISE_DOMAIN = [
  "sbicard.com", "kotak.bank", "icicibank", "icici.bank",
  "hdfcbank", "hdfc.bank", "axisbank", "axis.bank",
  "yesbank", "yes.bank", "sbi.co", "sbi.bank", "bankalerts",
  "paytm.com", "phonepe.com", "gpay",
  "gst.gov.in", "incometax.gov.in",
  "facebookmail.com", "facebook.com", "meta.com", "linkedin.com",
  "linkedinmail", "slack.com", "medium.com", "substack.com",
  "github.com", "gitlab.com", "googleplay", "googlecommunity",
  "youtube.com", "youtu.be", "appleid.apple.com",
  "anthropic.com", "openai.com", "cloudflare.com", "notion.so",
  "figma.com", "booking.com", "airbnb.com", "spicejet.com",
  "web-spicejet", "indigo.in", "airindia", "mmt.mp.makemytrip",
  "makemytrip.com", "uber.com", "olacabs", "amazon.in", "amazon.com",
  "flipkart.com", "myntra.com", "reliancedigital", "relianceretail",
  "tata1mg", "emaila.1mg.com", "1mg.com", "swiggy.in", "zomato.com",
  "freeletics", "updates.freeletics", "xpandstore", "email.intch",
  "intch.org", "myhq.in", "sendgrid", "mailgun", "mailchimp",
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
function parseAddr(addr: string): { name: string; email: string } {
  if (!addr) return { name: "", email: "" };
  const m = addr.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].toLowerCase() };
  return { name: "", email: addr.trim().toLowerCase() };
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
  const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days") ?? 14)));

  try {
    const [inRes, outRes] = await Promise.all([
      fetch("http://localhost:8005/api/v1/messages/?direction=inbound&limit=200", { cache: "no-store" }),
      fetch("http://localhost:8005/api/v1/messages/?direction=outbound&limit=200", { cache: "no-store" }),
    ]);
    if (!inRes.ok || !outRes.ok) {
      return Response.json({ error: "email-agent upstream" }, { status: 502 });
    }
    const inbound: Message[] = await inRes.json();
    const outbound: Message[] = await outRes.json();

    const lastSentTo: Record<string, number> = {};
    for (const m of outbound) {
      const t = Date.parse(m.sent_at || "");
      if (!Number.isFinite(t)) continue;
      for (const a of m.to_addresses || []) {
        const { email } = parseAddr(a);
        if (!email) continue;
        if (!lastSentTo[email] || t > lastSentTo[email]) {
          lastSentTo[email] = t;
        }
      }
    }

    const cutoff = Date.now() - days * 86400 * 1000;
    const rows = [];
    for (const m of inbound) {
      const t = Date.parse(m.sent_at || "");
      if (!Number.isFinite(t) || t < cutoff) continue;
      if (isNoise(m.from_address)) continue;
      const { email } = parseAddr(m.from_address);
      if (!email) continue;
      const replied = lastSentTo[email];
      if (replied && replied > t) continue;
      const ageHours = (Date.now() - t) / 3600000;
      rows.push({
        id: m.id,
        gmail_message_id: m.gmail_message_id,
        from: m.from_address,
        from_email: email,
        subject: (m.subject || "").slice(0, 200),
        sent_at: m.sent_at,
        age_hours: Math.round(ageHours * 10) / 10,
        is_read: !!m.is_read,
        action_needed: !!m.ai_action_needed,
        snippet: (m.snippet || m.body_text || "").slice(0, 280),
        category: m.ai_category || "unclassified",
        priority: m.ai_priority || "normal",
        ai_summary: m.ai_summary || "",
      });
    }

    rows.sort((a, b) => {
      const aAct = a.action_needed ? 1 : 0;
      const bAct = b.action_needed ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;
      const aR = a.is_read ? 1 : 0;
      const bR = b.is_read ? 1 : 0;
      if (aR !== bR) return aR - bR;
      return b.age_hours - a.age_hours;
    });

    return Response.json({ days, count: rows.length, rows });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
