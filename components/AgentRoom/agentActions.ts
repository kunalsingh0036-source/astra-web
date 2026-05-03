/**
 * Per-agent action catalogs.
 *
 * Each agent gets a set of grouped actions surfaced in the room's
 * ActionPanel. Actions are deliberate and specific — none of the old
 * "summarize this" / "what's happening" filler. Each action either
 * fires a structured Astra prompt with explicit context, or links
 * directly to a route that already does the thing.
 */

import type { AgentName } from "@/lib/types";
import type { ActionGroup } from "./ActionPanel";

const EMAIL: ActionGroup[] = [
  {
    title: "triage",
    actions: [
      {
        kind: "prompt",
        label: "what needs a reply today",
        hint: "ranked list of unanswered messages with suggested priorities",
        prompt:
          "Use the email agent to find every unanswered inbound from a real person in the last 7 days. Rank them by urgency (sender importance, deadline language, ask). For each, write 1 sentence on what they want and what should be replied. Output as a ranked list.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "draft replies to top 3",
        hint: "fires after triage — produces 3 draft artifacts",
        prompt:
          "Pick the top 3 emails from this morning that need a reply, draft a reply for each one in my voice (concise, direct, no fluff), and emit each draft as a draft artifact so I can review and send.",
      },
      {
        kind: "prompt",
        label: "summarize last 24h",
        hint: "newsletter-style digest of inbound activity",
        prompt:
          "Use the email agent to produce a 24-hour digest of inbound email — group by category (work / vendor / newsletter / personal), call out anything that needs my attention, ignore noise.",
      },
    ],
  },
  {
    title: "compose",
    actions: [
      {
        kind: "prompt",
        label: "draft a new email",
        hint: "you describe the recipient + intent, astra writes it",
        prompt:
          "I want to draft a new email. Ask me who it's to and what it's about, then draft it in my voice and emit as a draft artifact.",
      },
      {
        kind: "link",
        label: "open inbox view",
        hint: "full-page email pane with all recent threads",
        href: "/email",
      },
    ],
  },
];

const FINANCE: ActionGroup[] = [
  {
    title: "money in",
    actions: [
      {
        kind: "prompt",
        label: "draft reminders for overdue invoices",
        hint: "one polite-but-firm reminder per overdue line",
        prompt:
          "Use the finance agent to find every overdue invoice and draft a reminder email for each one. Tone: polite, brief, names the invoice number and amount, gives 7 days. Emit each as a draft artifact.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "cash forecast next 30 days",
        hint: "rolling forecast based on confirmed receivables + payables",
        prompt:
          "Use the finance agent to project cash flow for the next 30 days based on confirmed receivables (with realistic payment delays) and known payables. Show: starting balance, weekly net, ending balance, biggest risks.",
      },
    ],
  },
  {
    title: "money out",
    actions: [
      {
        kind: "custom",
        label: "log expense inline",
        hint: "quick-log without leaving the room",
        customKey: "finance-quick-log",
      },
      {
        kind: "prompt",
        label: "summarize this month's expenses",
        hint: "by category with trend vs last month",
        prompt:
          "Use the finance agent to summarize this month's expenses grouped by category, with a comparison to last month (% change). Flag anything that grew >30%.",
      },
    ],
  },
];

const WHATSAPP: ActionGroup[] = [
  {
    title: "respond",
    actions: [
      {
        kind: "prompt",
        label: "who's waiting on me",
        hint: "open conversations where the last message is from them",
        prompt:
          "Use the whatsapp agent to list every conversation where the last message was inbound (from them) and not replied to yet. For each, summarize what they want in one sentence.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "draft replies for the queue",
        hint: "one suggested reply per waiting conversation",
        prompt:
          "For every WhatsApp conversation waiting on me, draft a brief reply in my voice and emit each as a draft artifact for review.",
      },
    ],
  },
  {
    title: "outbound",
    actions: [
      {
        kind: "prompt",
        label: "send template message",
        hint: "pick approved template, choose recipient, fire",
        prompt:
          "I want to send a WhatsApp template message. Use the whatsapp agent to list approved templates first, then ask me which one and to whom.",
      },
      {
        kind: "prompt",
        label: "session window status",
        hint: "which numbers are inside the 24h free-form window",
        prompt:
          "Use the whatsapp agent to check the 24-hour session window status for every contact I've messaged recently. Show: which I can free-form reply to vs which require a template.",
      },
    ],
  },
];

const BOOKKEEPER: ActionGroup[] = [
  {
    title: "ledger",
    actions: [
      {
        kind: "prompt",
        label: "what's pending categorization",
        hint: "transactions waiting for me to confirm a category",
        prompt:
          "Use the bookkeeper agent to list transactions awaiting categorization. For each, suggest the category based on description and amount, plus one-line reasoning.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "month-end reconciliation status",
        hint: "what's matched, what's not, what needs decisions",
        prompt:
          "Use the bookkeeper agent to show this month's reconciliation status — bank vs ledger. List unmatched lines from each side and propose pairings where the model is confident.",
      },
    ],
  },
  {
    title: "compliance",
    actions: [
      {
        kind: "prompt",
        label: "GST filing readiness",
        hint: "are all this quarter's invoices captured?",
        prompt:
          "Use the bookkeeper agent to assess GST filing readiness for the current quarter. Show: invoices in vs invoices captured, gaps, whether numbers reconcile with the bank ledger.",
      },
      {
        kind: "prompt",
        label: "scan a receipt or invoice",
        hint: "drop the doc into chat — astra OCRs and books it",
        prompt:
          "I'm about to share a receipt or invoice with you. Use the bookkeeper agent's OCR to extract amount, vendor, date, and category, then create the ledger entry. Wait for me to attach the doc.",
      },
    ],
  },
];

const LINKEDIN: ActionGroup[] = [
  {
    title: "publish",
    actions: [
      {
        kind: "prompt",
        label: "draft a post for today",
        hint: "from my recent activity, drafts a post in my voice",
        prompt:
          "Use the linkedin agent + my recent activity (memories, tasks, decisions) to draft one LinkedIn post for today in my voice. No resume language, no AI tells, no business-school phrases. Emit as a draft artifact for review before posting.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "show the queue",
        hint: "drafts and scheduled posts in the linkedin agent",
        prompt:
          "Use the linkedin agent to list every draft and scheduled post currently in the queue. Show: status, scheduled time, first 100 chars of content.",
      },
      {
        kind: "prompt",
        label: "comment on my feed",
        hint: "drafts thoughtful comments on top posts I should engage with",
        prompt:
          "Use the linkedin agent to pull the top posts in my feed today, identify 3-5 worth engaging on (founder/operator content, not pure thought-leadership), and draft a thoughtful comment for each in my voice. Emit each as a draft artifact.",
      },
    ],
  },
  {
    title: "analyze",
    actions: [
      {
        kind: "prompt",
        label: "performance of last 5 posts",
        hint: "engagement breakdown + what worked",
        prompt:
          "Use the linkedin agent to pull engagement on my last 5 posts (likes, comments, reposts, dwell). Identify what worked vs what didn't with a 1-sentence theory per post.",
      },
    ],
  },
];

const HELMTECH: ActionGroup[] = [
  {
    title: "outreach",
    actions: [
      {
        kind: "prompt",
        label: "what's in the outbound queue",
        hint: "leads ready to send + 24h delivery status",
        prompt:
          "Use the helmtech agent to show the current outbound queue: how many leads are queued for WhatsApp, how many sent in the last 24h, delivery rates, any failures.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "approve next batch",
        hint: "review pending leads before they go out",
        prompt:
          "Use the helmtech agent to show the next batch of leads pending approval for outbound. For each: name, company, what we're pitching, why this lead. Wait for my go/no-go on each.",
      },
      {
        kind: "prompt",
        label: "templates awaiting meta approval",
        hint: "any blockers on whatsapp template review?",
        prompt:
          "Use the helmtech agent to list WhatsApp templates currently awaiting Meta approval. For each: name, status, days in review, what's blocking.",
      },
    ],
  },
  {
    title: "intelligence",
    actions: [
      {
        kind: "prompt",
        label: "research the next 5 prospects",
        hint: "deep-dive briefs for the top of the queue",
        prompt:
          "Take the next 5 prospects in the helmtech outbound queue and produce a research brief on each: what their company does, recent news, why we're a fit, what to mention specifically in our outreach. Emit each as a research artifact.",
      },
    ],
  },
];

const APEX: ActionGroup[] = [
  {
    title: "outreach",
    actions: [
      {
        kind: "prompt",
        label: "what's in apex outbound today",
        hint: "human-touch queue + cadence position per lead",
        prompt:
          "Use the apex agent to show today's human outreach queue: who's up, what step of the cadence each lead is at, what we sent last time, any responses that came back.",
        primary: true,
      },
      {
        kind: "prompt",
        label: "draft this morning's batch",
        hint: "personalized message per lead, in my voice",
        prompt:
          "Take the apex outreach queue for today and draft a personalized outbound message for each lead in my voice (warm, direct, references something specific about them). Emit each as a draft artifact for review before sending.",
      },
    ],
  },
  {
    title: "intelligence",
    actions: [
      {
        kind: "prompt",
        label: "responses since yesterday",
        hint: "anyone reply? what tone? next step?",
        prompt:
          "Use the apex agent to list every response received in the last 24h. For each: who, what they said in 1 sentence, what they're indicating (yes/no/maybe), suggested next step.",
      },
    ],
  },
];

export const AGENT_ACTIONS: Record<AgentName, ActionGroup[]> = {
  email: EMAIL,
  finance: FINANCE,
  whatsapp: WHATSAPP,
  bookkeeper: BOOKKEEPER,
  linkedin: LINKEDIN,
  helmtech: HELMTECH,
  apex: APEX,
};
