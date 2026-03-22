import { NextResponse } from "next/server";

import { getMarketDiagnosticsRange } from "@/lib/api-football/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDateKey = searchParams.get("start");
  const endDateKey = searchParams.get("end") ?? startDateKey;
  const timeZone = searchParams.get("timeZone") ?? undefined;
  const minOdds = searchParams.get("min_odds");
  const maxOdds = searchParams.get("max_odds");

  if (!startDateKey || !endDateKey) {
    return NextResponse.json(
      { ok: false, error: "Missing start/end date" },
      { status: 400 }
    );
  }

  try {
    const diagnostics = await getMarketDiagnosticsRange({
      startDateKey,
      endDateKey,
      timeZone,
      minOdds: minOdds ? Number(minOdds) : undefined,
      maxOdds: maxOdds ? Number(maxOdds) : undefined
    });

    return NextResponse.json({
      ok: true,
      startDateKey,
      endDateKey,
      timeZone,
      diagnostics
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
