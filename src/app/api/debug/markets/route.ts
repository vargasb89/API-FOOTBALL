import { NextRequest, NextResponse } from "next/server";

import { getTopEdgesByMarketRange } from "@/lib/api-football/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end") ?? start;
  const timeZone = searchParams.get("timeZone") ?? "America/Bogota";
  const minOddsParam = searchParams.get("min_odds");
  const maxOddsParam = searchParams.get("max_odds");

  if (!start || !end) {
    return NextResponse.json(
      {
        error: "start and end are required in yyyy-MM-dd format"
      },
      { status: 400 }
    );
  }

  const minOdds = minOddsParam ? Number(minOddsParam) : undefined;
  const maxOdds = maxOddsParam ? Number(maxOddsParam) : undefined;

  const groups = await getTopEdgesByMarketRange({
    startDate: new Date(`${start}T12:00:00`),
    endDate: new Date(`${end}T12:00:00`),
    minOdds,
    maxOdds,
    timeZone
  });

  return NextResponse.json({
    start,
    end,
    timeZone,
    groups: groups.map((group) => ({
      market: group.market,
      label: group.label,
      count: group.entries.length,
      entries: group.entries.map(({ fixture, offer }) => ({
        fixtureId: fixture.fixture.id,
        date: fixture.fixture.date,
        league: fixture.league.name,
        home: fixture.teams.home.name,
        away: fixture.teams.away.name,
        bookmaker: offer.bookmaker,
        odds: offer.odds,
        impliedProbability: offer.impliedProbability,
        modeledProbability: offer.modeledProbability,
        edge: offer.edge,
        expectedValue: offer.expectedValue
      }))
    }))
  });
}
