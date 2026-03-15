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
import { queryDb } from "@/lib/db";
import {
  getDateInputValueInTimeZone,
  getDefaultTimeZone,
  getFixtureDateInTimeZone,
  shiftDateKey
} from "@/lib/timezone";
import { getRedis } from "@/lib/redis";
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
const MARKET_SNAPSHOT_TTL_SECONDS = 90;

type SnapshotCacheEntry = {
  expiresAt: number;
  value: MarketLeaderboardEntry[];
};

const marketSnapshotCache = new Map<string, SnapshotCacheEntry>();

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

function buildMarketSnapshotKey({
  startDateKey,
  endDateKey,
  minOdds,
  maxOdds,
  timeZone
}: MarketQuery) {
  const params = new URLSearchParams({
    start: startDateKey,
    end: endDateKey,
    timeZone: timeZone ?? getDefaultTimeZone()
  });

  if (typeof minOdds === "number") {
    params.set("minOdds", String(minOdds));
  }

  if (typeof maxOdds === "number") {
    params.set("maxOdds", String(maxOdds));
  }

  return `market-snapshot:${params.toString()}`;
}

async function readMarketSnapshot(cacheKey: string) {
  const inMemory = marketSnapshotCache.get(cacheKey);

  if (inMemory && inMemory.expiresAt > Date.now()) {
    return inMemory.value;
  }

  const redis = getRedis();
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as MarketLeaderboardEntry[];
      marketSnapshotCache.set(cacheKey, {
        value: parsed,
        expiresAt: Date.now() + MARKET_SNAPSHOT_TTL_SECONDS * 1000
      });
      return parsed;
    }
  }

  const rows = await queryDb<{ response_json: MarketLeaderboardEntry[] }>(
    "select response_json from api_cache where cache_key = $1 and expires_at > now()",
    [cacheKey]
  );

  const value = rows?.[0]?.response_json ?? null;

  if (value) {
    marketSnapshotCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + MARKET_SNAPSHOT_TTL_SECONDS * 1000
    });
  }

  return value;
}

async function writeMarketSnapshot(cacheKey: string, value: MarketLeaderboardEntry[]) {
  marketSnapshotCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + MARKET_SNAPSHOT_TTL_SECONDS * 1000
  });

  const redis = getRedis();
  if (redis) {
    await redis.set(cacheKey, JSON.stringify(value), "EX", MARKET_SNAPSHOT_TTL_SECONDS);
  }

  await queryDb(
    `insert into api_cache (cache_key, response_json, expires_at, updated_at)
     values ($1, $2::jsonb, now() + ($3 || ' seconds')::interval, now())
     on conflict (cache_key)
     do update set response_json = excluded.response_json,
                   expires_at = excluded.expires_at,
                   updated_at = now()`,
    [cacheKey, JSON.stringify(value), MARKET_SNAPSHOT_TTL_SECONDS]
  );
}

async function fetchFixturesForApiDate(dateKey: string) {
  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    {
      date: dateKey
    }
  );

  return payload.response;
}

function getApiDateKeysForLocalDate(dateKey: string, timeZone?: string) {
  if (!timeZone) {
    return [dateKey];
  }

  return [shiftDateKey(dateKey, -1), dateKey, shiftDateKey(dateKey, 1)];
}

function isActionableFixture(fixture: FixtureSummary) {
  const status = fixture.fixture.status.short;

  return !["FT", "AET", "PEN", "CANC", "ABD", "AWD", "WO", "PST"].includes(status);
}

export async function getFixturesByDate(dateKey: string, timeZone?: string) {
  const mainLeagueIds = getMainLeagueIds();
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const apiDateKeys = getApiDateKeysForLocalDate(dateKey, resolvedTimeZone);
  const payloads = await Promise.all(
    apiDateKeys.map((apiDateKey) => fetchFixturesForApiDate(apiDateKey))
  );
  const fixtures = dedupeFixtures(payloads.flat());

  return sortFixtures(
    fixtures.filter((fixture) => {
      const matchesLeague = mainLeagueIds.length
        ? mainLeagueIds.includes(fixture.league.id)
        : isTrackedLeague(fixture.league.country, fixture.league.name);
      const matchesLocalDate = resolvedTimeZone
        ? getFixtureDateInTimeZone(fixture.fixture.date, resolvedTimeZone) === dateKey
        : true;
      const matchesStatus = isActionableFixture(fixture);

      return matchesLeague && matchesLocalDate && matchesStatus;
    })
  );
}

function enumerateDateKeys(startDateKey: string, endDateKey: string) {
  const dates: string[] = [];
  let current = startDateKey;

  while (current <= endDateKey) {
    dates.push(current);
    current = shiftDateKey(current, 1);
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
  timeZone?: string;
}) {
  const apiDates = getApiDateKeysForLocalDate(filters.date, filters.timeZone);
  const payloads = await Promise.all(
    apiDates.map((apiDate) =>
      apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>("/fixtures", {
        date: apiDate,
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
        isActionableFixture(fixture) &&
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
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const todayDateKey = getDateInputValueInTimeZone(new Date(), resolvedTimeZone);
  const fixtures = await getFixturesByDate(todayDateKey, resolvedTimeZone);
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
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const dateKey = getDateInputValueInTimeZone(date, resolvedTimeZone);
  const fixtures = await getFixturesByDate(dateKey, resolvedTimeZone);
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
  startDateKey: string;
  endDateKey: string;
  minOdds?: number;
  maxOdds?: number;
  timeZone?: string;
};

async function getMarketEntries({
  startDateKey,
  endDateKey,
  minOdds,
  maxOdds,
  timeZone
}: MarketQuery) {
  const cacheKey = buildMarketSnapshotKey({
    startDateKey,
    endDateKey,
    minOdds,
    maxOdds,
    timeZone
  });
  const cachedSnapshot = await readMarketSnapshot(cacheKey);

  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const dates = enumerateDateKeys(startDateKey, endDateKey);
  const fixturesByDay = await Promise.all(
    dates.map((dateKey) => getFixturesByDate(dateKey, timeZone))
  );
  const fixtures = sortFixtures(dedupeFixtures(fixturesByDay.flat()));
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

  const filteredEntries = filterEntriesByOdds(entries, minOdds, maxOdds);
  await writeMarketSnapshot(cacheKey, filteredEntries);

  return filteredEntries;
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
