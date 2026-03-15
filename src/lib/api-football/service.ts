import { format } from "date-fns";

import { apiFootballGet } from "@/lib/api-football/client";
import type {
  ApiFootballEnvelope,
  FixtureStatisticsRow,
  FixtureSummary,
  OddsBookmaker,
  StandingRow,
  TeamStatistics
} from "@/lib/api-football/types";
import { isTrackedLeague } from "@/lib/competition-scope";
import { getMainLeagueIds } from "@/lib/config/env";
import {
  buildProbabilityModel,
  extractBestMarketOffers,
  groupOffersByMarket,
  groupModelProbabilitiesByMarket,
  type MarketLeaderboardEntry
} from "@/lib/market-analysis";

const MARKET_WHITELIST = new Set([
  "Goals Over/Under",
  "Both Teams Score",
  "Home Team Over/Under",
  "Away Team Over/Under"
]);

function sortFixtures(fixtures: FixtureSummary[]) {
  return [...fixtures].sort((left, right) => {
    const dateDelta =
      new Date(left.fixture.date).getTime() - new Date(right.fixture.date).getTime();

    if (dateDelta !== 0) {
      return dateDelta;
    }

    return left.fixture.id - right.fixture.id;
  });
}

export async function getFixturesByDate(date = new Date()) {
  const mainLeagueIds = getMainLeagueIds();
  const formattedDate = format(date, "yyyy-MM-dd");
  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    {
      date: formattedDate
    }
  );

  return sortFixtures(
    payload.response.filter((fixture) =>
      mainLeagueIds.length
        ? mainLeagueIds.includes(fixture.league.id)
        : isTrackedLeague(fixture.league.country, fixture.league.name)
    )
  );
}

function enumerateDates(start: Date, end: Date) {
  const dates: Date[] = [];
  const current = new Date(start);
  current.setHours(12, 0, 0, 0);
  const limit = new Date(end);
  limit.setHours(12, 0, 0, 0);

  while (current <= limit) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function filterEntriesByOdds(
  entries: MarketLeaderboardEntry[],
  minOdds?: number,
  maxOdds?: number
) {
  return entries.filter(({ offer }) => {
    const matchesMin = minOdds ? offer.odds >= minOdds : true;
    const matchesMax = maxOdds ? offer.odds <= maxOdds : true;

    return matchesMin && matchesMax;
  });
}

export async function getLeagueStandings(league: number, season: number) {
  const payload = await apiFootballGet<
    ApiFootballEnvelope<Array<{ league: { standings: StandingRow[][] } }>>
  >("/standings", { league, season }, 300);

  return payload.response[0]?.league.standings[0] ?? [];
}

export async function getTeamStatistics(team: number, league: number, season: number) {
  const payload = await apiFootballGet<ApiFootballEnvelope<TeamStatistics>>(
    "/teams/statistics",
    { team, league, season },
    300
  );

  return payload.response ?? null;
}

export async function getRecentTeamFixtures(
  team: number,
  season: number,
  last = 20,
  league?: number
) {
  const params: Record<string, string | number> = {
    team,
    season,
    last
  };

  if (league) {
    params.league = league;
  }

  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    params,
    300
  );

  return sortFixtures(payload.response);
}

export async function getFixtureContext(fixtureId: number) {
  const fixturePayload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    { id: fixtureId }
  );

  const fixture = fixturePayload.response[0];
  const homeTeamId = fixture?.teams.home.id;
  const awayTeamId = fixture?.teams.away.id;
  const h2h = homeTeamId && awayTeamId ? `${homeTeamId}-${awayTeamId}` : "";

  const [statsPayload, h2hPayload, lineupPayload, injuryPayload, oddsPayload] =
    await Promise.all([
      apiFootballGet<ApiFootballEnvelope<FixtureStatisticsRow[]>>("/fixtures/statistics", {
        fixture: fixtureId
      }),
      h2h
        ? apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>("/fixtures/headtohead", {
            h2h
          })
        : Promise.resolve({ response: [], errors: [], results: 0 }),
      apiFootballGet<ApiFootballEnvelope<unknown[]>>("/fixtures/lineups", {
        fixture: fixtureId
      }).catch(() => ({ response: [], errors: [], results: 0 })),
      apiFootballGet<ApiFootballEnvelope<unknown[]>>("/injuries", {
        fixture: fixtureId
      }).catch(() => ({ response: [], errors: [], results: 0 })),
      apiFootballGet<ApiFootballEnvelope<Array<{ bookmakers: OddsBookmaker[] }>>>(
        "/odds",
        { fixture: fixtureId },
        120
      ).catch(() => ({ response: [], errors: [], results: 0 }))
    ]);

  const bookmakers =
    oddsPayload.response[0]?.bookmakers?.map((bookmaker) => ({
      ...bookmaker,
      bets: bookmaker.bets.filter((bet) => MARKET_WHITELIST.has(bet.name))
    })) ?? [];

  const season = fixture?.league.season;
  const league = fixture?.league.id;
  const [standings, homeStats, awayStats, homeRecentFixtures, awayRecentFixtures] =
    fixture && homeTeamId && awayTeamId && season && league
      ? await Promise.all([
          getLeagueStandings(league, season),
          getTeamStatistics(homeTeamId, league, season),
          getTeamStatistics(awayTeamId, league, season),
          getRecentTeamFixtures(homeTeamId, season, 20),
          getRecentTeamFixtures(awayTeamId, season, 20)
        ])
      : [[], null, null, [], []];

  const probabilityModel =
    fixture && homeTeamId && awayTeamId
      ? buildProbabilityModel({
          fixture,
          homeStats,
          awayStats,
          homeRecentFixtures,
          awayRecentFixtures,
          h2hFixtures: h2hPayload.response,
          standings
        })
      : null;
  const marketOffers = probabilityModel
    ? extractBestMarketOffers(bookmakers, probabilityModel)
    : [];

  return {
    fixture,
    statistics: statsPayload.response,
    h2h: h2hPayload.response,
    lineups: lineupPayload.response,
    injuries: injuryPayload.response,
    bookmakers,
    standings,
    homeStats,
    awayStats,
    homeRecentFixtures,
    awayRecentFixtures,
    probabilityModel,
    marketOffers
  };
}

export async function getMatchExplorerData(filters: {
  date: string;
  league?: string;
  season?: string;
}) {
  const params: Record<string, string> = {
    date: filters.date
  };

  if (filters.league) {
    params.league = filters.league;
  }

  if (filters.season) {
    params.season = filters.season;
  }

  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    params
  );

  return sortFixtures(
    payload.response.filter((fixture) =>
      isTrackedLeague(fixture.league.country, fixture.league.name)
    )
  );
}

export async function getTeamPageData(teamId: number, league: number, season: number) {
  const [statistics, standings] = await Promise.all([
    getTeamStatistics(teamId, league, season),
    getLeagueStandings(league, season)
  ]);

  return {
    statistics,
    standing: standings.find((row) => row.team.id === teamId) ?? null
  };
}

export async function getDashboardInsights() {
  const fixtures = await getFixturesByDate();
  const topFixtures = fixtures.slice(0, 8);

  const opportunities = await Promise.all(
    topFixtures.map(async (fixture) => {
      const context = await getFixtureContext(fixture.fixture.id);
      return {
        fixture,
        offers: context.marketOffers.slice(0, 2)
      };
    })
  );

  return {
    fixtures,
    opportunities: opportunities.filter((item) => item.offers.length > 0)
  };
}

export async function getTopEdgesByMarket(date = new Date()) {
  const fixtures = await getFixturesByDate(date);
  const contexts = await Promise.all(
    fixtures.slice(0, 10).map(async (fixture) => ({
      fixture,
      context: await getFixtureContext(fixture.fixture.id)
    }))
  );

  const entries: MarketLeaderboardEntry[] = contexts.flatMap(({ fixture, context }) =>
    context.marketOffers.map((offer) => ({
      fixture,
      offer
    }))
  );

  return groupOffersByMarket(entries).map((group) => ({
    ...group,
    entries: group.entries.slice(0, 5)
  }));
}

type MarketQuery = {
  startDate: Date;
  endDate: Date;
  minOdds?: number;
  maxOdds?: number;
};

async function getMarketEntries({ startDate, endDate, minOdds, maxOdds }: MarketQuery) {
  const dates = enumerateDates(startDate, endDate);
  const fixturesByDay = await Promise.all(dates.map((date) => getFixturesByDate(date)));
  const fixtures = sortFixtures(fixturesByDay.flat()).slice(0, 40);
  const contexts = await Promise.all(
    fixtures.map(async (fixture) => ({
      fixture,
      context: await getFixtureContext(fixture.fixture.id)
    }))
  );

  const entries: MarketLeaderboardEntry[] = contexts.flatMap(({ fixture, context }) =>
    context.marketOffers.map((offer) => ({
      fixture,
      offer
    }))
  );

  return filterEntriesByOdds(entries, minOdds, maxOdds);
}

export async function getTopEdgesByMarketRange(query: MarketQuery) {
  const entries = await getMarketEntries(query);
  return groupOffersByMarket(entries).map((group) => ({
    ...group,
    entries: group.entries.slice(0, 5)
  }));
}

export async function getTopModelProbabilitiesByMarketRange(query: MarketQuery) {
  const entries = await getMarketEntries(query);

  return groupModelProbabilitiesByMarket(entries).map((group) => ({
    ...group,
    entries: group.entries.slice(0, 5)
  }));
}
