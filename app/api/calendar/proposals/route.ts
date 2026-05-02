import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/calendar/proposals
 *
 * Lists calendar_event_proposals rows. Defaults to pending only.
 * `?status=all|pending|approved|applied|rejected|expired|error`
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  kind: string;
  source: string;
  calendar_id: string;
  summary: string;
  description: string;
  location: string;
  start_at: string | null;
  end_at: string | null;
  tz: string;
  is_all_day: boolean;
  attendees_json: string;
  recurrence_json: string | null;
  google_id: string | null;
  resulting_google_id: string | null;
  status: string;
  created_at: string;
  approved_at: string | null;
  applied_at: string | null;
  error: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const source = url.searchParams.get("source");

  const pool = astraPool();
  try {
    const whereParts: string[] = [];
    const args: (string | number)[] = [];
    if (status !== "all") {
      args.push(status);
      whereParts.push(`status = $${args.length}`);
    }
    if (source) {
      args.push(source);
      whereParts.push(`source = $${args.length}`);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const { rows } = await pool.query<Row>(
      `SELECT id, kind, source, calendar_id, summary, description, location,
              start_at, end_at, tz, is_all_day, attendees_json,
              recurrence_json, google_id, resulting_google_id,
              status, created_at, approved_at, applied_at, error
       FROM calendar_event_proposals
       ${where}
       ORDER BY COALESCE(start_at, created_at) ASC
       LIMIT 100`,
      args,
    );
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
