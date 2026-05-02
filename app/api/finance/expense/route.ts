import type { NextRequest } from "next/server";

/**
 * POST /api/finance/expense
 *
 * Quick-log proxy to finance-agent's /api/v1/expenses endpoint. If
 * the caller doesn't provide a business_id, we pick the first
 * business we can find on the agent — that's fine for a single-owner
 * setup.
 *
 * Body: { vendor, amount, category?, date?, description? }
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
  const amountRaw = body.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  if (!vendor || !Number.isFinite(amount) || amount < 0) {
    return Response.json(
      { error: "vendor and non-negative amount required" },
      { status: 400 },
    );
  }
  const category =
    typeof body.category === "string" && body.category.trim()
      ? body.category.trim()
      : "uncategorized";
  const description =
    typeof body.description === "string" ? body.description : "";
  const dateStr =
    typeof body.date === "string" && body.date.length > 0
      ? body.date
      : new Date().toISOString().slice(0, 10);

  const financeUrl = process.env.FINANCE_URL ?? "http://localhost:8004";

  let businessId = typeof body.business_id === "string" ? body.business_id : "";
  if (!businessId) {
    try {
      const bres = await fetch(`${financeUrl}/api/v1/businesses/`, {
        cache: "no-store",
      });
      if (bres.ok) {
        const bs = (await bres.json()) as Array<{ id: string }>;
        businessId = bs[0]?.id ?? "";
      }
    } catch {
      /* handled below */
    }
    if (!businessId) {
      return Response.json(
        {
          error:
            "no business configured on finance-agent — pass business_id explicitly",
        },
        { status: 400 },
      );
    }
  }

  try {
    const up = await fetch(`${financeUrl}/api/v1/expenses/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        category,
        amount: amount.toFixed(2),
        tax_amount: "0.00",
        vendor_name: vendor,
        description,
        expense_date: dateStr,
      }),
      cache: "no-store",
    });
    const text = await up.text();
    return new Response(text, {
      status: up.status,
      headers: {
        "content-type":
          up.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "finance agent unreachable" },
      { status: 502 },
    );
  }
}
