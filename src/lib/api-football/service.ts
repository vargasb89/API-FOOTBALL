import { apiFootballGet } from "@/lib/api-football/client";
import type {
  ApiFootballEnvelope,
  FixtureStatisticsRow,
  FixtureSummary,
  OddsBookmaker,
  StandingRow,
  TeamStatistics
} from "@/lib/api-football/types";
import {
  TRACKED_LEAGUES,
  findTrackedLeague,
  findTrackedLeagueByName,
  isTrackedLeague,
  type LeagueCategory
} from "@/lib/competition-scope";
import { getMainLeagueIds } from "@/lib/config/env";
import { queryDb } from "@/lib/db";
import { readModelCache, writeModelCache } from "@/lib/model-cache";
import { readDailySnapshot, writeDailySnapshot } from "@/lib/snapshots";
import {
  getDateInputValueInTimeZone,
  getDefaultTimeZone,
  getFixtureDateInTimeZone,
  shiftDateKey
} from "@/lib/timezone";
import {
  buildProbabilityModel,
  extractBestMarketOffers,
  groupOffersByMarket,
  groupModelProbabilitiesByMarket,
  type MarketOffer,
  type MarketLeaderboardEntry
} from "@/lib/market-analysis";

const MARKET_WHITELIST = new Set([
  "Goals Over/Under",
  "Both Teams Score",
  "Home Team Over/Under",
  "Away Team Over/Under",
  "Total - Home",
  "Total - Away",
  "First Half Goals Over/Under",
  "1st Half Goals Over/Under",
  "Goals Over/Under First Half"
]);
const MARKET_GROUP_LIMIT = 10;
const FIXTURE_SNAPSHOT_TYPE = "fixtures_by_local_day";
const MARKET_SNAPSHOT_VERSION = "v4";
const MARKET_SNAPSHOT_TYPE = `market_entries_by_local_day_${MARKET_SNAPSHOT_VERSION}`;
const SNAPSHOT_CONTEXT_CONCURRENCY = 1;
const FIXTURE_MARKET_SNAPSHOT_PREFIX = `fixture_market_offers_${MARKET_SNAPSHOT_VERSION}`;
const LEAGUE_STANDINGS_CACHE = "league_standings";
const TEAM_STATISTICS_CACHE = "team_statistics";
const TEAM_RECENT_FIXTURES_CACHE = "team_recent_fixtures";
const H2H_FIXTURES_CACHE = "head_to_head";
const FIXTURE_ODDS_CACHE = "fixture_odds_v2";

export class SnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotUnavailableError";
  }
}

export class PartialMarketDataError extends Error {
  constructor(
    message: string,
    readonly entries: MarketLeaderboardEntry[]
  ) {
    super(message);
    this.name = "PartialMarketDataError";
  }
}

type MarketSnapshotCaches = {
  standings: Map<string, StandingRow[]>;
  teamStats: Map<string, TeamStatistics | null>;
  recentFixtures: Map<string, FixtureSummary[]>;
  h2h: Map<string, FixtureSummary[]>;
};

function summarizeFailures(
  failures: string[],
  label: string
) {
  const preview = failures.slice(0, 3).join(" | ");
  const remaining = failures.length - 3;
  const suffix = remaining > 0 ? ` | +${remaining} ${label} adicionales` : "";

  return `${failures.length} ${label} pendientes. ${preview}${suffix}`;
}

function hasUsableSnapshot<T>(payload: T[] | null): payload is T[] {
  return Array.isArray(payload) && payload.length > 0;
}

function hasUsableModelCache<T>(payload: T | null | undefined) {
  if (payload == null) {
    return false;
  }

  if (Array.isArray(payload)) {
    return payload.length > 0;
  }

  if (typeof payload === "object") {
    return Object.keys(payload).length > 0;
  }

  return true;
}

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

function buildSnapshotKey(dateKey: string, timeZone?: string) {
  return `${timeZone ?? getDefaultTimeZone()}::${dateKey}`;
}

function buildLeagueStandingsCacheKey(league: number, season: number) {
  return `${league}-${season}`;
}

function buildTeamStatisticsCacheKey(team: number, league: number, season: number) {
  return `${team}-${league}-${season}`;
}

function buildTeamRecentFixturesCacheKey(
  team: number,
  season: number,
  last: number,
  league?: number
) {
  return `${team}-${season}-${last}-${league ?? "all"}`;
}

function buildHeadToHeadCacheKey(h2h: string) {
  return h2h;
}

function buildFixtureOddsCacheKey(fixtureId: number) {
  return String(fixtureId);
}

function buildFixtureMarketSnapshotName(dateKey: string, timeZone?: string) {
  return `${FIXTURE_MARKET_SNAPSHOT_PREFIX}::${buildSnapshotKey(dateKey, timeZone)}`;
}

async function readFixtureMarketEntries(
  fixtureId: number,
  dateKey: string,
  timeZone?: string
) {
  const rows = await queryDb<{ payload: MarketOffer[] }>(
    `select payload
     from market_snapshots
     where fixture_id = $1
       and market_name = $2
     order by created_at desc
     limit 1`,
    [fixtureId, buildFixtureMarketSnapshotName(dateKey, timeZone)]
  );

  const payload = rows?.[0]?.payload ?? null;
  return hasUsableSnapshot(payload) ? payload : null;
}

async function readFixtureMarketEntriesMap(
  fixtureIds: number[],
  dateKey: string,
  timeZone?: string
) {
  if (!fixtureIds.length) {
    return new Map<number, MarketOffer[]>();
  }

  const rows = await queryDb<{ fixture_id: number; payload: MarketOffer[] }>(
    `select distinct on (fixture_id) fixture_id, payload
     from market_snapshots
     where fixture_id = any($1::bigint[])
       and market_name = $2
     order by fixture_id, created_at desc`,
    [fixtureIds, buildFixtureMarketSnapshotName(dateKey, timeZone)]
  );

  return new Map(
    (rows ?? [])
      .filter((row) => hasUsableSnapshot(row.payload))
      .map((row) => [Number(row.fixture_id), row.payload])
  );
}

async function writeFixtureMarketEntries(
  fixtureId: number,
  dateKey: string,
  payload: MarketOffer[],
  timeZone?: string
) {
  if (!hasUsableSnapshot(payload)) {
    return;
  }

  await queryDb(
    `insert into market_snapshots (fixture_id, market_name, bookmaker_name, payload)
     values ($1, $2, $3, $4::jsonb)`,
    [
      fixtureId,
      buildFixtureMarketSnapshotName(dateKey, timeZone),
      "snapshot",
      JSON.stringify(payload)
    ]
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
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

async function fetchFixturesForTrackedLeagueByDate(
  trackedLeagueId: number,
  dateKey: string,
  season?: string,
  timeZone?: string
) {
  const inferredSeason = season ?? dateKey.slice(0, 4);
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const apiDateKeys = getApiDateKeysForLocalDate(dateKey, resolvedTimeZone);
  const payloads = await Promise.all(
    apiDateKeys.map((apiDateKey) =>
      apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>("/fixtures", {
        date: apiDateKey,
        league: trackedLeagueId,
        season: inferredSeason
      })
    )
  );

  return sortFixtures(
    dedupeFixtures(payloads.flatMap((payload) => payload.response)).filter(
      (fixture) =>
        getFixtureDateInTimeZone(fixture.fixture.date, resolvedTimeZone) === dateKey &&
        isActionableFixture(fixture)
    )
  );
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

async function fetchAndStoreFixturesByDate(dateKey: string, timeZone?: string) {
  const mainLeagueIds = getMainLeagueIds();
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const snapshotKey = buildSnapshotKey(dateKey, resolvedTimeZone);
  const apiDateKeys = getApiDateKeysForLocalDate(dateKey, resolvedTimeZone);
  const payloads = await Promise.all(
    apiDateKeys.map((apiDateKey) => fetchFixturesForApiDate(apiDateKey))
  );
  const fixtures = dedupeFixtures(payloads.flat());

  const filteredFixtures = sortFixtures(
    fixtures.filter((fixture) => {
      const matchesLeague = mainLeagueIds.length
        ? mainLeagueIds.includes(fixture.league.id) ||
          isTrackedLeague(fixture.league.country, fixture.league.name)
        : isTrackedLeague(fixture.league.country, fixture.league.name);
      const matchesLocalDate = resolvedTimeZone
        ? getFixtureDateInTimeZone(fixture.fixture.date, resolvedTimeZone) === dateKey
        : true;
      const matchesStatus = isActionableFixture(fixture);

      return matchesLeague && matchesLocalDate && matchesStatus;
    })
  );

  await writeDailySnapshot(FIXTURE_SNAPSHOT_TYPE, snapshotKey, filteredFixtures);

  return filteredFixtures;
}

export async function getFixturesByDate(
  dateKey: string,
  timeZone?: string,
  options?: { requireSnapshot?: boolean }
) {
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const snapshotKey = buildSnapshotKey(dateKey, resolvedTimeZone);
  const cachedSnapshot = await readDailySnapshot<FixtureSummary[]>(
    FIXTURE_SNAPSHOT_TYPE,
    snapshotKey
  );

  if (hasUsableSnapshot(cachedSnapshot)) {
    return sortFixtures(cachedSnapshot);
  }

  if (options?.requireSnapshot) {
    throw new SnapshotUnavailableError(
      `No existe snapshot guardado para ${dateKey} en ${resolvedTimeZone}.`
    );
  }

  return fetchAndStoreFixturesByDate(dateKey, resolvedTimeZone);
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
  const cacheKey = buildLeagueStandingsCacheKey(league, season);
  const cached = await readModelCache<StandingRow[]>(LEAGUE_STANDINGS_CACHE, cacheKey);

  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  const payload = await apiFootballGet<
    ApiFootballEnvelope<Array<{ league: { standings: StandingRow[][] } }>>
  >("/standings", { league, season }, 300);

  const standings = payload.response[0]?.league.standings[0] ?? [];
  await writeModelCache(LEAGUE_STANDINGS_CACHE, cacheKey, standings);

  return standings;
}

export async function getTeamStatistics(team: number, league: number, season: number) {
  const cacheKey = buildTeamStatisticsCacheKey(team, league, season);
  const cached = await readModelCache<TeamStatistics | null>(
    TEAM_STATISTICS_CACHE,
    cacheKey
  );

  if (cached && Object.keys(cached).length > 0) {
    return cached;
  }

  const payload = await apiFootballGet<ApiFootballEnvelope<TeamStatistics>>(
    "/teams/statistics",
    { team, league, season },
    300
  );

  const statistics = payload.response ?? null;
  await writeModelCache(TEAM_STATISTICS_CACHE, cacheKey, statistics);

  return statistics;
}

export async function getRecentTeamFixtures(
  team: number,
  season: number,
  last = 20,
  league?: number
) {
  const cacheKey = buildTeamRecentFixturesCacheKey(team, season, last, league);
  const cached = await readModelCache<FixtureSummary[]>(
    TEAM_RECENT_FIXTURES_CACHE,
    cacheKey
  );

  if (Array.isArray(cached) && cached.length > 0) {
    return sortFixtures(cached);
  }

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

  const fixtures = sortFixtures(payload.response);
  await writeModelCache(TEAM_RECENT_FIXTURES_CACHE, cacheKey, fixtures);

  return fixtures;
}

async function getHeadToHeadFixtures(h2h: string) {
  const cacheKey = buildHeadToHeadCacheKey(h2h);
  const cached = await readModelCache<FixtureSummary[]>(H2H_FIXTURES_CACHE, cacheKey);

  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures/headtohead",
    { h2h }
  );
  const fixtures = payload.response;
  await writeModelCache(H2H_FIXTURES_CACHE, cacheKey, fixtures);

  return fixtures;
}

async function getFixtureOddsBookmakers(fixtureId: number) {
  const cacheKey = buildFixtureOddsCacheKey(fixtureId);
  const cached = await readModelCache<OddsBookmaker[]>(FIXTURE_ODDS_CACHE, cacheKey);

  if (hasUsableSnapshot(cached)) {
    return cached;
  }

  const oddsPayload = await apiFootballGet<ApiFootballEnvelope<Array<{ bookmakers: OddsBookmaker[] }>>>(
    "/odds",
    { fixture: fixtureId },
    120
  ).catch(() => ({ response: [], errors: [], results: 0 }));

  const bookmakers =
    oddsPayload.response[0]?.bookmakers?.map((bookmaker) => ({
      ...bookmaker,
      bets: bookmaker.bets.filter((bet) => MARKET_WHITELIST.has(bet.name))
    })) ?? [];

  if (hasUsableSnapshot(bookmakers)) {
    await writeModelCache(FIXTURE_ODDS_CACHE, cacheKey, bookmakers);
  }

  return bookmakers;
}

async function buildFixtureContext(fixture: FixtureSummary | undefined, fixtureId: number) {
  const homeTeamId = fixture?.teams.home.id;
  const awayTeamId = fixture?.teams.away.id;
  const h2h = homeTeamId && awayTeamId ? `${homeTeamId}-${awayTeamId}` : "";

  const [statsPayload, h2hFixtures, lineupPayload, injuryPayload, bookmakers] =
    await Promise.all([
      apiFootballGet<ApiFootballEnvelope<FixtureStatisticsRow[]>>("/fixtures/statistics", {
        fixture: fixtureId
      }),
      h2h ? getHeadToHeadFixtures(h2h) : Promise.resolve([]),
      apiFootballGet<ApiFootballEnvelope<unknown[]>>("/fixtures/lineups", {
        fixture: fixtureId
      }).catch(() => ({ response: [], errors: [], results: 0 })),
      apiFootballGet<ApiFootballEnvelope<unknown[]>>("/injuries", {
        fixture: fixtureId
      }).catch(() => ({ response: [], errors: [], results: 0 })),
      getFixtureOddsBookmakers(fixtureId)
    ]);

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
          h2hFixtures,
          standings
        })
      : null;
  const marketOffers = probabilityModel
    ? extractBestMarketOffers(bookmakers, probabilityModel)
    : [];

  return {
    fixture,
    statistics: statsPayload.response,
    h2h: h2hFixtures,
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

async function buildMarketSnapshotContext(
  fixture: FixtureSummary,
  caches: MarketSnapshotCaches
) {
  const fixtureId = fixture.fixture.id;
  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;
  const season = fixture.league.season;
  const league = fixture.league.id;
  const h2hKey = `${homeTeamId}-${awayTeamId}`;
  const standingsKey = `${league}-${season}`;
  const homeStatsKey = `${homeTeamId}-${league}-${season}`;
  const awayStatsKey = `${awayTeamId}-${league}-${season}`;
  const homeRecentKey = `${homeTeamId}-${season}`;
  const awayRecentKey = `${awayTeamId}-${season}`;

  const [
    bookmakers,
    standings,
    homeStats,
    awayStats,
    homeRecentFixtures,
    awayRecentFixtures,
    h2hFixtures
  ] = await Promise.all([
    getFixtureOddsBookmakers(fixtureId),
    (async () => {
      if (!caches.standings.has(standingsKey)) {
        caches.standings.set(standingsKey, await getLeagueStandings(league, season));
      }

      return caches.standings.get(standingsKey) ?? [];
    })(),
    (async () => {
      if (!caches.teamStats.has(homeStatsKey)) {
        caches.teamStats.set(homeStatsKey, await getTeamStatistics(homeTeamId, league, season));
      }

      return caches.teamStats.get(homeStatsKey) ?? null;
    })(),
    (async () => {
      if (!caches.teamStats.has(awayStatsKey)) {
        caches.teamStats.set(awayStatsKey, await getTeamStatistics(awayTeamId, league, season));
      }

      return caches.teamStats.get(awayStatsKey) ?? null;
    })(),
    (async () => {
      if (!caches.recentFixtures.has(homeRecentKey)) {
        caches.recentFixtures.set(homeRecentKey, await getRecentTeamFixtures(homeTeamId, season, 20));
      }

      return caches.recentFixtures.get(homeRecentKey) ?? [];
    })(),
    (async () => {
      if (!caches.recentFixtures.has(awayRecentKey)) {
        caches.recentFixtures.set(awayRecentKey, await getRecentTeamFixtures(awayTeamId, season, 20));
      }

      return caches.recentFixtures.get(awayRecentKey) ?? [];
    })(),
    (async () => {
      if (!caches.h2h.has(h2hKey)) {
        caches.h2h.set(h2hKey, await getHeadToHeadFixtures(h2hKey));
      }

      return caches.h2h.get(h2hKey) ?? [];
    })()
  ]);

  const probabilityModel = buildProbabilityModel({
    fixture,
    homeStats,
    awayStats,
    homeRecentFixtures,
    awayRecentFixtures,
    h2hFixtures,
    standings
  });

  return extractBestMarketOffers(bookmakers, probabilityModel);
}

async function buildAndStoreMarketEntriesByDate(
  dateKey: string,
  timeZone?: string,
  caches?: MarketSnapshotCaches
) {
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const snapshotKey = buildSnapshotKey(dateKey, resolvedTimeZone);
  const fixtures = await getFixturesByDate(dateKey, resolvedTimeZone);
  const resolvedCaches =
    caches ??
    ({
      standings: new Map<string, StandingRow[]>(),
      teamStats: new Map<string, TeamStatistics | null>(),
      recentFixtures: new Map<string, FixtureSummary[]>(),
      h2h: new Map<string, FixtureSummary[]>()
    } satisfies MarketSnapshotCaches);
  const entries: MarketLeaderboardEntry[] = [];
  const failures: string[] = [];
  const fixtureEntriesMap = await readFixtureMarketEntriesMap(
    fixtures.map((fixture) => fixture.fixture.id),
    dateKey,
    resolvedTimeZone
  );

  for (const fixture of fixtures) {
    const cachedFixtureOffers = fixtureEntriesMap.get(fixture.fixture.id) ?? null;

    if (cachedFixtureOffers !== null) {
      entries.push(
        ...cachedFixtureOffers.map((offer) => ({
          fixture,
          offer
        }))
      );
      continue;
    }

    try {
      const marketOffers = await buildMarketSnapshotContext(fixture, resolvedCaches);

      await writeFixtureMarketEntries(
        fixture.fixture.id,
        dateKey,
        marketOffers,
        resolvedTimeZone
      );

      entries.push(
        ...marketOffers.map((offer) => ({
          fixture,
          offer
        }))
      );
    } catch (error) {
      failures.push(
        `${fixture.fixture.id}: ${error instanceof Error ? error.message : "No se pudo calcular el mercado"}`
      );
    }
  }

  await writeDailySnapshot(MARKET_SNAPSHOT_TYPE, snapshotKey, entries);

  if (failures.length) {
    if (entries.length) {
      throw new PartialMarketDataError(
        `Se guardaron mercados parciales para ${dateKey}. ${summarizeFailures(failures, "fixtures")}`,
        entries
      );
    }

    throw new SnapshotUnavailableError(
      `No se pudieron construir mercados para ${dateKey}. ${summarizeFailures(failures, "fixtures")}`
    );
  }

  return entries;
}

export async function getFixtureContext(
  fixtureId: number,
  fixtureSeed?: FixtureSummary
) {
  if (fixtureSeed) {
    return buildFixtureContext(fixtureSeed, fixtureId);
  }

  const fixturePayload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
    "/fixtures",
    { id: fixtureId }
  );

  return buildFixtureContext(fixturePayload.response[0], fixtureId);
}

export async function getMatchExplorerData(filters: {
  date: string;
  league?: string;
  season?: string;
  timeZone?: string;
}) {
  return sortFixtures(
    (await getFixturesByDate(filters.date, filters.timeZone)).filter(
      (fixture) =>
        isTrackedLeague(fixture.league.country, fixture.league.name) &&
        (!filters.league || String(fixture.league.id) === filters.league) &&
        (!filters.season || String(fixture.league.season) === filters.season)
    )
  );
}

export async function getLeagueModelViewData(filters: {
  date: string;
  league?: string;
  season?: string;
  country?: string;
  category?: string;
  timeZone?: string;
}) {
  const resolvedTimeZone = filters.timeZone ?? getDefaultTimeZone();
  const selectedTrackedLeague =
    filters.league && filters.country
      ? findTrackedLeague(filters.country, filters.league)
      : filters.league
        ? findTrackedLeagueByName(filters.league)
        : undefined;
  const filterFixtures = (fixtures: FixtureSummary[]) =>
    fixtures.filter((fixture) => {
      const bySeason = filters.season
        ? String(fixture.league.season) === filters.season
        : true;
      const trackedLeague = findTrackedLeague(fixture.league.country, fixture.league.name);
      const byCountry = selectedTrackedLeague
        ? trackedLeague?.country === selectedTrackedLeague.country
        : filters.country
          ? fixture.league.country === filters.country
          : true;
      const byLeague = selectedTrackedLeague
        ? trackedLeague?.country === selectedTrackedLeague.country &&
          trackedLeague?.name === selectedTrackedLeague.name
        : filters.league
          ? fixture.league.name === filters.league ||
            String(fixture.league.id) === filters.league
          : true;
      const byCategory = filters.category
        ? trackedLeague?.categories.includes(filters.category as LeagueCategory)
        : true;

      return bySeason && byCountry && byLeague && byCategory;
    });

  const initialFixtures = await getMatchExplorerData({
    date: filters.date,
    season: filters.season,
    timeZone: resolvedTimeZone
  });

  let filteredFixtures = filterFixtures(initialFixtures);

  if (!filteredFixtures.length && selectedTrackedLeague?.id) {
    const leagueFixtures = await fetchFixturesForTrackedLeagueByDate(
      selectedTrackedLeague.id,
      filters.date,
      filters.season,
      resolvedTimeZone
    );
    filteredFixtures = filterFixtures(leagueFixtures);
  }

  if (!filteredFixtures.length) {
    const refreshedFixtures = await fetchAndStoreFixturesByDate(filters.date, resolvedTimeZone);
    filteredFixtures = filterFixtures(refreshedFixtures);
  }

  const contexts = await Promise.allSettled(
    filteredFixtures.map(async (fixture) => {
      const context = await getFixtureContext(fixture.fixture.id, fixture);
      return {
        fixture,
        offers: [...context.marketOffers].sort(
          (left, right) =>
            right.modeledProbability - left.modeledProbability || right.edge - left.edge
        )
      };
    })
  );

  return Promise.all(
    contexts.map(async (result, index) => {
      const fixture = filteredFixtures[index];

      if (result.status === "fulfilled") {
        return {
          fixture,
          trackedLeague: findTrackedLeague(fixture.league.country, fixture.league.name),
          offers: result.value.offers
        };
      }

      const storedOffers =
        (await readFixtureMarketEntries(fixture.fixture.id, filters.date, resolvedTimeZone)) ??
        [];

      return {
        fixture,
        trackedLeague: findTrackedLeague(fixture.league.country, fixture.league.name),
        offers: [...storedOffers].sort(
          (left, right) =>
            right.modeledProbability - left.modeledProbability || right.edge - left.edge
        )
      };
    })
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
      const context = await getFixtureContext(fixture.fixture.id, fixture);
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
      context: await getFixtureContext(fixture.fixture.id, fixture)
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
  const dates = enumerateDateKeys(startDateKey, endDateKey);
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const caches: MarketSnapshotCaches = {
    standings: new Map<string, StandingRow[]>(),
    teamStats: new Map<string, TeamStatistics | null>(),
    recentFixtures: new Map<string, FixtureSummary[]>(),
    h2h: new Map<string, FixtureSummary[]>()
  };
  const entriesByDay: MarketLeaderboardEntry[][] = [];
  const failures: string[] = [];

  for (const dateKey of dates) {
    const snapshotKey = buildSnapshotKey(dateKey, resolvedTimeZone);
    const cachedSnapshot = await readDailySnapshot<MarketLeaderboardEntry[]>(
      MARKET_SNAPSHOT_TYPE,
      snapshotKey
    );

    if (hasUsableSnapshot(cachedSnapshot)) {
      entriesByDay.push(cachedSnapshot);
      continue;
    }

    const rebuiltEntries = await rebuildDailyMarketSnapshotFromFixtureSnapshots(
      dateKey,
      resolvedTimeZone
    );

    if (rebuiltEntries.length) {
      entriesByDay.push(rebuiltEntries);
      continue;
    }

    try {
      const builtEntries = await buildAndStoreMarketEntriesByDate(
        dateKey,
        resolvedTimeZone,
        caches
      );
      entriesByDay.push(builtEntries);
    } catch (error) {
      if (error instanceof PartialMarketDataError) {
        entriesByDay.push(error.entries);
      }

      failures.push(
        error instanceof Error
          ? `${dateKey}: ${error.message}`
          : `${dateKey}: No se pudieron construir los mercados`
      );
    }
  }

  const filteredEntries = filterEntriesByOdds(entriesByDay.flat(), minOdds, maxOdds);

  if (!filteredEntries.length && failures.length) {
    throw new SnapshotUnavailableError(
      `No se pudieron obtener mercados para el rango solicitado. ${summarizeFailures(
        failures,
        "fechas"
      )}`
    );
  }

  if (filteredEntries.length && failures.length) {
    throw new PartialMarketDataError(
      `Se muestran resultados parciales. ${summarizeFailures(failures, "fechas")}`,
      filteredEntries
    );
  }

  return filteredEntries;
}

export type MarketDiagnostics = {
  market: string;
  label: string;
  totalEntries: number;
  positiveEdges: number;
  maxModeledProbability: number | null;
  maxEdge: number | null;
  sample: Array<{
    fixtureId: number;
    match: string;
    bookmaker: string;
    odds: number;
    modeledProbability: number;
    edge: number;
  }>;
};

export async function getMarketDiagnosticsRange(query: MarketQuery) {
  const entries = await getMarketEntries(query);

  return groupModelProbabilitiesByMarket(entries).map((group) => {
    const positiveEdges = group.entries.filter((entry) => entry.offer.edge > 0).length;
    const maxModeledProbability = group.entries.length
      ? Math.max(...group.entries.map((entry) => entry.offer.modeledProbability))
      : null;
    const maxEdge = group.entries.length
      ? Math.max(...group.entries.map((entry) => entry.offer.edge))
      : null;

    return {
      market: group.market,
      label: group.label,
      totalEntries: group.entries.length,
      positiveEdges,
      maxModeledProbability,
      maxEdge,
      sample: group.entries.slice(0, 5).map((entry) => ({
        fixtureId: entry.fixture.fixture.id,
        match: `${entry.fixture.teams.home.name} vs ${entry.fixture.teams.away.name}`,
        bookmaker: entry.offer.bookmaker,
        odds: entry.offer.odds,
        modeledProbability: entry.offer.modeledProbability,
        edge: entry.offer.edge
      }))
    } satisfies MarketDiagnostics;
  });
}

function isRateLimitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("too many requests") || message.includes("rate limit");
}

async function collectStoredMarketEntriesByDate(
  fixtures: FixtureSummary[],
  dateKey: string,
  timeZone?: string
) {
  const storedMap = await readFixtureMarketEntriesMap(
    fixtures.map((fixture) => fixture.fixture.id),
    dateKey,
    timeZone
  );

  return fixtures.flatMap((fixture) =>
    (storedMap.get(fixture.fixture.id) ?? []).map((offer) => ({
      fixture,
      offer
    }))
  );
}

async function rebuildDailyMarketSnapshotFromFixtureSnapshots(
  dateKey: string,
  timeZone?: string
) {
  const resolvedTimeZone = timeZone ?? getDefaultTimeZone();
  const fixtures = await getFixturesByDate(dateKey, resolvedTimeZone, {
    requireSnapshot: true
  });
  const aggregatedEntries = await collectStoredMarketEntriesByDate(
    fixtures,
    dateKey,
    resolvedTimeZone
  );

  if (aggregatedEntries.length) {
    await writeDailySnapshot(
      MARKET_SNAPSHOT_TYPE,
      buildSnapshotKey(dateKey, resolvedTimeZone),
      aggregatedEntries
    );
  }

  return aggregatedEntries;
}

export async function processMarketSnapshotBatch(params: {
  dateKey: string;
  timeZone?: string;
  limit?: number;
}) {
  const resolvedTimeZone = params.timeZone ?? getDefaultTimeZone();
  const limit = Math.max(1, params.limit ?? 10);
  const fixtures = await getFixturesByDate(params.dateKey, resolvedTimeZone);
  const storedMap = await readFixtureMarketEntriesMap(
    fixtures.map((fixture) => fixture.fixture.id),
    params.dateKey,
    resolvedTimeZone
  );
  const pendingFixtures = fixtures.filter(
    (fixture) => !storedMap.has(fixture.fixture.id)
  );
  const caches: MarketSnapshotCaches = {
    standings: new Map<string, StandingRow[]>(),
    teamStats: new Map<string, TeamStatistics | null>(),
    recentFixtures: new Map<string, FixtureSummary[]>(),
    h2h: new Map<string, FixtureSummary[]>()
  };
  const failures: string[] = [];
  let processedInRun = 0;

  for (const fixture of pendingFixtures.slice(0, limit)) {
    try {
      const marketOffers = await buildMarketSnapshotContext(fixture, caches);
      await writeFixtureMarketEntries(
        fixture.fixture.id,
        params.dateKey,
        marketOffers,
        resolvedTimeZone
      );
      processedInRun += 1;
    } catch (error) {
      failures.push(
        `${fixture.fixture.id}: ${error instanceof Error ? error.message : "No se pudo calcular el mercado"}`
      );

      if (isRateLimitError(error)) {
        break;
      }
    }
  }

  const aggregatedEntries = await collectStoredMarketEntriesByDate(
    fixtures,
    params.dateKey,
    resolvedTimeZone
  );

  await writeDailySnapshot(
    MARKET_SNAPSHOT_TYPE,
    buildSnapshotKey(params.dateKey, resolvedTimeZone),
    aggregatedEntries
  );

  const remainingMap = await readFixtureMarketEntriesMap(
    fixtures.map((fixture) => fixture.fixture.id),
    params.dateKey,
    resolvedTimeZone
  );
  const pendingCount = fixtures.filter(
    (fixture) => !remainingMap.has(fixture.fixture.id)
  ).length;

  return {
    dateKey: params.dateKey,
    fixtures: fixtures.length,
    processedInRun,
    storedFixtures: remainingMap.size,
    pendingFixtures: pendingCount,
    marketEntries: aggregatedEntries.length,
    failures
  };
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

export async function loadSnapshotRange(params: {
  startDateKey: string;
  endDateKey: string;
  timeZone?: string;
  limitPerDate?: number;
}) {
  const resolvedTimeZone = params.timeZone ?? getDefaultTimeZone();
  const dates = enumerateDateKeys(params.startDateKey, params.endDateKey);
  const summary: Array<{
    dateKey: string;
    fixtures: number;
    marketEntries: number;
    processedInRun: number;
    storedFixtures: number;
    pendingFixtures: number;
    failures: string[];
  }> = [];

  for (const dateKey of dates) {
    await getFixturesByDate(dateKey, resolvedTimeZone);
    const batch = await processMarketSnapshotBatch({
      dateKey,
      timeZone: resolvedTimeZone,
      limit: params.limitPerDate
    });

    summary.push({
      dateKey,
      fixtures: batch.fixtures,
      marketEntries: batch.marketEntries,
      processedInRun: batch.processedInRun,
      storedFixtures: batch.storedFixtures,
      pendingFixtures: batch.pendingFixtures,
      failures: batch.failures
    });
  }

  return summary;
}
