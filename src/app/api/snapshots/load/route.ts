import { NextRequest, NextResponse } from "next/server";

import { loadSnapshotRange } from "@/lib/api-football/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end") ?? start;
  const timeZone = searchParams.get("timeZone") ?? "America/Bogota";

  if (!start || !end) {
    return NextResponse.json(
      {
        error: "start and end are required in yyyy-MM-dd format"
      },
      { status: 400 }
    );
  }

  try {
    const summary = await loadSnapshotRange({
      startDateKey: start,
      endDateKey: end,
      timeZone
    });

    return NextResponse.json({
      ok: true,
      start,
      end,
      timeZone,
      summary
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load snapshots"
      },
      { status: 500 }
    );
  }
}
