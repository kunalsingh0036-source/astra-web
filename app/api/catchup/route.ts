import type { NextRequest } from "next/server";
import { astraPool } from "@/lib/db";

/**
 * GET /api/catchup
 *
 * Lists catchup_approvals rows. Default returns just pending ones
 * (the /tonight page's primary view), but ?status= can override or
 * include "all".
 *
 * Returns rows newest-first.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  reply_id: string;
  decrements: Record<string, number>;
  before_counters: Record<string, number | null>;
  projected_after: Record<string, number | null>;
  hours_reported: Record<string, number> | null;
  status: string;
  created_at: string;
  approved_at: string | null;
  applied_at: string | null;
  error: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";

  const pool = astraPool();
  try {
    const { rows } = await pool.query<Row>(
      status === "all"
        ? `SELECT id, reply_id, decrements, before_counters,
                  projected_after, hours_reported, status,
                  created_at, approved_at, applied_at, error
           FROM catchup_approvals
           ORDER BY created_at DESC
           LIMIT 20`
        : `SELECT id, reply_id, decrements, before_counters,
                  projected_after, hours_reported, status,
                  created_at, approved_at, applied_at, error
           FROM catchup_approvals
           WHERE status = $1
           ORDER BY created_at DESC
           LIMIT 20`,
      status === "all" ? [] : [status],
    );
    return Response.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/catchup
 *
 * Body: { stretch, meditate, breathe, movement, skill, workout } — hours.
 *
 * Computes the projected deltas against the current "Kunal" note
 * counters (reads from apple_notes mirror) and stages a pending
 * approval row. Returns the id so the UI can redirect to the review.
 *
 * This is the PRIMARY submission path — what /tonight's form posts to.
 * It does NOT touch the Apple Note; the Apply button on /tonight
 * flips status to 'approved', and the 60s scheduler job writes.
 */
const TYPES = [
  "stretch",
  "meditate",
  "breathe",
  "movement",
  "skill",
  "workout",
] as const;

type HoursBody = Record<(typeof TYPES)[number], number | string | null>;

export async function POST(req: NextRequest) {
  let body: Partial<HoursBody> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Normalize + validate. Accept numbers or numeric strings.
  const hours: Record<string, number> = {};
  for (const t of TYPES) {
    const v = body[t];
    const n = typeof v === "string" ? Number(v) : (v ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 24) {
      return Response.json(
        { error: `invalid hours for ${t}: ${v}` },
        { status: 400 },
      );
    }
    hours[t] = n;
  }

  // Convert hours -> session decrements (1 session == 1 hour for now,
  // round to nearest int; drop zeros).
  const decrements: Record<string, number> = {};
  for (const [t, h] of Object.entries(hours)) {
    const s = Math.round(h);
    if (s > 0) decrements[t] = s;
  }
  if (Object.keys(decrements).length === 0) {
    return Response.json(
      { error: "no hours to log — at least one counter must be > 0" },
      { status: 400 },
    );
  }

  const pool = astraPool();

  // Pull the latest Kunal-note counters out of the mirror — same
  // parse regex as astra/notes/missed_sessions.py.
  const kunal = await pool.query<{ body_text: string }>(
    `SELECT body_text
     FROM apple_notes
     WHERE title = 'Kunal'
     ORDER BY modified_at_native DESC NULLS LAST
     LIMIT 1`,
  );
  if (kunal.rowCount === 0) {
    return Response.json(
      { error: "Kunal note not found in mirror" },
      { status: 500 },
    );
  }
  const bodyText = kunal.rows[0].body_text ?? "";

  const before = parseCounters(bodyText);
  const projected_after: Record<string, number | null> = { ...before };
  const applied: Record<string, number> = {};
  for (const [t, s] of Object.entries(decrements)) {
    const cur = before[t] ?? null;
    if (cur === null) continue;
    const newVal = Math.max(0, cur - s);
    const realDec = cur - newVal;
    if (realDec > 0) {
      projected_after[t] = newVal;
      applied[t] = realDec;
    }
  }
  if (Object.keys(applied).length === 0) {
    return Response.json(
      {
        error: "no counters would change — possibly already zero",
        before,
        hours,
      },
      { status: 400 },
    );
  }

  // replyId convention for hand-submitted rows.
  const replyId = `form-${Date.now()}`;

  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO catchup_approvals
         (reply_id, decrements, before_counters,
          projected_after, hours_reported, status)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, 'pending')
       ON CONFLICT (reply_id) DO UPDATE
         SET decrements = EXCLUDED.decrements,
             projected_after = EXCLUDED.projected_after,
             hours_reported = EXCLUDED.hours_reported
       RETURNING id`,
      [
        replyId,
        JSON.stringify(applied),
        JSON.stringify(before),
        JSON.stringify(projected_after),
        JSON.stringify(hours),
      ],
    );
    return Response.json({
      id: rows[0].id,
      replyId,
      decrements: applied,
      before,
      projected_after,
      hours,
      status: "pending",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ── helpers ──────────────────────────────────────────────────────

const COUNTER_RE =
  /\b(stretch|meditate|breathe|breathing|movement|skill|workout)\s*[-–—:]\s*(\d+)/gi;

function parseCounters(body: string): Record<string, number | null> {
  const anchor = body.search(/saturday\s*[-–—]\s*sunday/i);
  const section = anchor >= 0 ? body.slice(anchor) : body;
  const out: Record<string, number | null> = {
    stretch: null,
    meditate: null,
    breathe: null,
    movement: null,
    skill: null,
    workout: null,
  };
  const seen = new Set<string>();
  for (const m of section.matchAll(COUNTER_RE)) {
    let t = m[1].toLowerCase();
    if (t === "breathing") t = "breathe";
    if (seen.has(t)) continue;
    seen.add(t);
    out[t] = Number(m[2]);
  }
  return out;
}
