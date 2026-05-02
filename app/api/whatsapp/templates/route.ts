/**
 * GET /api/whatsapp/templates
 *
 * Proxies to the whatsapp-gateway templates endpoint. Filters to
 * approved templates by default (the only ones Meta will actually
 * deliver), but `include_all=true` returns every row for admin use.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeAll = url.searchParams.get("include_all") === "true";
  const waUrl = process.env.WHATSAPP_URL ?? "http://localhost:8600";
  try {
    const up = await fetch(`${waUrl}/api/v1/templates/`, { cache: "no-store" });
    if (!up.ok) {
      return Response.json({ error: `gateway ${up.status}` }, { status: up.status });
    }
    const rows = (await up.json()) as Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      status: string;
    }>;
    const filtered = includeAll ? rows : rows.filter((t) => t.status === "approved");
    return Response.json({
      count: filtered.length,
      templates: filtered.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
      })),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "gateway unreachable" },
      { status: 502 },
    );
  }
}
