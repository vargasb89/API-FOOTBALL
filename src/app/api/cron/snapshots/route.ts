import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/config/env";
import { loadSnapshotRange } from "@/lib/api-football/service";
import { getDateInputValueInTimeZone, shiftDateKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const env = getEnv();

  if (!env.CRON_SECRET) {
    return true;
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const querySecret = new URL(request.url).searchParams.get("secret");

  return bearer === env.CRON_SECRET || querySecret === env.CRON_SECRET;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const timeZone = searchParams.get("timeZone") ?? "America/Bogota";
  const daysAhead = Math.max(0, Number(searchParams.get("daysAhead") ?? "2"));
  const limitPerDate = Math.max(1, Number(searchParams.get("limit") ?? "10"));
  const start = searchParams.get("start") ?? getDateInputValueInTimeZone(new Date(), timeZone);
  const end = searchParams.get("end") ?? shiftDateKey(start, daysAhead);

  try {
    const summary = await loadSnapshotRange({
      startDateKey: start,
      endDateKey: end,
      timeZone,
      limitPerDate
    });

    return NextResponse.json({
      ok: true,
      mode: "background-job",
      start,
      end,
      timeZone,
      limitPerDate,
      summary
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Snapshot job failed"
      },
      { status: 500 }
    );
  }
}
