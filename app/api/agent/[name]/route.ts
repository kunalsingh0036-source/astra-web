import { NextRequest, NextResponse } from "next/server";
import type { AgentName } from "@/lib/types";

/**
 * GET /api/agent/[name]
 *
 * Returns everything the Agent Room page needs to render a single
 * agent in one HTTP round-trip. Each agent has a different native API,
 * so we adapt here in one place rather than leaking those shapes into
 * the client.
 *
 * All calls are parallel, with a hard timeout, and failures degrade
 * to `null` fields — the page still renders.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  name: string;
}

const URL_FOR: Record<AgentName, string | undefined> = {
  email: process.env.EMAIL_URL,
  finance: process.env.FINANCE_URL,
  whatsapp: process.env.WHATSAPP_URL,
  bookkeeper: process.env.BOOKKEEPER_URL,
  linkedin: process.env.LINKEDIN_URL,
  helmtech: process.env.HELMTECH_URL,
  apex: process.env.APEX_URL,
};

async function safeJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type Snapshot = Record<string, unknown>;

async function buildEmail(baseUrl: string, signal: AbortSignal): Promise<Snapshot> {
  const [summary, accounts, messages] = await Promise.all([
    safeJson<Record<string, unknown>>(`${baseUrl}/api/v1/messages/summary`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/accounts/`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/messages/?limit=6`, signal),
  ]);
  return {
    summary,
    accounts: accounts ?? [],
    recent: messages ?? [],
  };
}

async function buildFinance(baseUrl: string, signal: AbortSignal): Promise<Snapshot> {
  const [dashboard, businesses, invoices, expenses] = await Promise.all([
    safeJson<Record<string, unknown>>(`${baseUrl}/api/v1/dashboard/`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/businesses/`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/invoices/?limit=6`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/expenses/?limit=6`, signal),
  ]);
  return {
    dashboard,
    businesses: businesses ?? [],
    invoices: invoices ?? [],
    expenses: expenses ?? [],
  };
}

async function buildWhatsApp(baseUrl: string, signal: AbortSignal): Promise<Snapshot> {
  const [stats, templates, conversations] = await Promise.all([
    safeJson<Record<string, unknown>>(`${baseUrl}/api/v1/stats`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/templates/`, signal),
    safeJson<unknown[]>(`${baseUrl}/api/v1/conversations/?limit=6`, signal),
  ]);
  return {
    stats,
    templates: templates ?? [],
    conversations: conversations ?? [],
  };
}

const BUILDERS: Partial<
  Record<AgentName, (url: string, signal: AbortSignal) => Promise<Snapshot>>
> = {
  email: buildEmail,
  finance: buildFinance,
  whatsapp: buildWhatsApp,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { name } = await params;
  const agent = name as AgentName;
  const url = URL_FOR[agent];

  if (!url) {
    return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  }

  const builder = BUILDERS[agent];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    // Always probe /health so we can show liveness, even for agents
    // without a custom builder.
    const health = await safeJson<Record<string, unknown>>(
      `${url}/health`,
      controller.signal,
    );

    const snapshot = builder
      ? await builder(url, controller.signal)
      : { note: "no custom room — showing health only" };

    return NextResponse.json({
      agent,
      reachable: Boolean(health),
      health,
      snapshot,
      probedAt: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
}
