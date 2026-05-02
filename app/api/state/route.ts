import { NextResponse } from "next/server";
import { probeFleet } from "@/lib/fleet";

/**
 * GET /api/state
 *
 * Returns the current fleet state as JSON. Polled by the client every
 * ~10s via useFleetState. Always fresh — no caching — because state
 * changes second-by-second when the fleet is busy.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const state = await probeFleet();
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
