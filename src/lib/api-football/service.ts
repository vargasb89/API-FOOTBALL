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
import { getFixtureDateInTimeZone, isFixtureWithinDateRange } from "@/lib/timezone";
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
const MARKET_GROUP_LIMIT = 10;

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

function dedupeFixtures(fixtures: FixtureSummary[]) {
  const unique = new Map<number, FixtureSummary>();

  for (const fixture of fixtures) {
    unique.set(fixture.fixture.id, fixture);
  }

  return [...unique.values()];
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

async function fetchFixturesForApiDate(date: Date) {
  const formattedDate = format(date, "yyyy-MM-dd");
  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    {
      date: formattedDate
    }
  );

  return payload.response;
}

export async function getFixturesByDate(date = new Date(), timeZone?: string) {
  const mainLeagueIds = getMainLeagueIds();
  const formattedDate = format(date, "yyyy-MM-dd");
  const apiDates = timeZone ? [addDays(date, -1), date, addDays(date, 1)] : [date];
  const payloads = await Promise.all(apiDates.map((apiDate) => fetchFixturesForApiDate(apiDate)));
  const fixtures = dedupeFixtures(payloads.flat());

  return sortFixtures(
    fixtures.filter((fixture) => {
      const matchesLeague = mainLeagueIds.length
        ? mainLeagueIds.includes(fixture.league.id)
        : isTrackedLeague(fixture.league.country, fixture.league.name);
      const matchesLocalDate = timeZone
        ? getFixtureDateInTimeZone(fixture.fixture.date, timeZone) === formattedDate
        : true;

      return matchesLeague && matchesLocalDate;
    })
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

function normalizeSearchValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterEntriesByMatchQuery(
  entries: MarketLeaderboardEntry[],
  matchQuery?: string
) {
  if (!matchQuery?.trim()) {
    return entries;
  }

  const queryTokens = normalizeSearchValue(matchQuery)
    .split(" ")
    .filter(Boolean);

  return entries.filter(({ fixture }) => {
    const haystack = normalizeSearchValue(
      `${fixture.teams.home.name} ${fixture.teams.away.name} ${fixture.league.name}`
    );

    return queryTokens.every((token) => haystack.includes(token));
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
  timeZone?: string;
}) {
  const targetDate = new Date(`${filters.date}T12:00:00`);
  const apiDates = filters.timeZone
    ? [addDays(targetDate, -1), targetDate, addDays(targetDate, 1)]
    : [targetDate];
  const payloads = await Promise.all(
    apiDates.map((apiDate) =>
      apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>("/fixtures", {
        date: format(apiDate, "yyyy-MM-dd"),
        ...(filters.league ? { league: filters.league } : {}),
        ...(filters.season ? { season: filters.season } : {})
      })
    )
  );
  const fixtures = dedupeFixtures(payloads.flatMap((payload) => payload.response));

  return sortFixtures(
    fixtures.filter(
      (fixture) =>
        isTrackedLeague(fixture.league.country, fixture.league.name) &&
        (!filters.timeZone ||
          getFixtureDateInTimeZone(fixture.fixture.date, filters.timeZone) === filters.date)
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

export async function getDashboardInsights(timeZone?: string) {
  const fixtures = await getFixturesByDate(new Date(), timeZone);
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

export async function getTopEdgesByMarket(date = new Date(), timeZone?: string) {
  const fixtures = await getFixturesByDate(date, timeZone);
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
    entries: group.entries.slice(0, MARKET_GROUP_LIMIT)
  }));
}

type MarketQuery = {
  startDate: Date;
  endDate: Date;
  minOdds?: number;
  maxOdds?: number;
  timeZone?: string;
  matchQuery?: string;
};

async function getMarketEntries({
  startDate,
  endDate,
  minOdds,
  maxOdds,
  timeZone,
  matchQuery
}: MarketQuery) {
  const dates = enumerateDates(startDate, endDate);
  const fixturesByDay = await Promise.all(dates.map((date) => getFixturesByDate(date, timeZone)));
  const startDateKey = format(startDate, "yyyy-MM-dd");
  const endDateKey = format(endDate, "yyyy-MM-dd");
  const fixtures = sortFixtures(
    fixturesByDay
      .flat()
      .filter((fixture) =>
        timeZone
          ? isFixtureWithinDateRange(
              fixture.fixture.date,
              timeZone,
              startDateKey,
              endDateKey
            )
          : true
      )
  ).slice(0, 40);
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

  return filterEntriesByMatchQuery(
    filterEntriesByOdds(entries, minOdds, maxOdds),
    matchQuery
  );
}

export async function getTopEdgesByMarketRange(query: MarketQuery) {
  const entries = await getMarketEntries(query);
  return groupOffersByMarket(entries).map((group) => ({
    ...group,
    entries: group.entries.slice(0, MARKET_GROUP_LIMIT)
  }));
}

export async function getTopModelProbabilitiesByMarketRange(query: MarketQuery) {
  const entries = await getMarketEntries(query);

  return groupModelProbabilitiesByMarket(entries).map((group) => ({
    ...group,
    entries: group.entries.slice(0, MARKET_GROUP_LIMIT)
  }));
}
