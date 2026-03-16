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
  "Away Team Over/Under"
]);
const MARKET_GROUP_LIMIT = 10;
const FIXTURE_SNAPSHOT_TYPE = "fixtures_by_local_day";
const MARKET_SNAPSHOT_TYPE = "market_entries_by_local_day";
const SNAPSHOT_CONTEXT_CONCURRENCY = 1;
const FIXTURE_MARKET_SNAPSHOT_PREFIX = "fixture_market_offers";

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

function hasUsableSnapshot<T>(payload: T[] | null): payload is T[] {
  return Array.isArray(payload) && payload.length > 0;
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

  return rows?.[0]?.payload ?? null;
}

async function writeFixtureMarketEntries(
  fixtureId: number,
  dateKey: string,
  payload: MarketOffer[],
  timeZone?: string
) {
  if (!payload.length) {
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
        ? mainLeagueIds.includes(fixture.league.id)
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

async function buildFixtureContext(fixture: FixtureSummary | undefined, fixtureId: number) {
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
    oddsPayload,
    standings,
    homeStats,
    awayStats,
    homeRecentFixtures,
    awayRecentFixtures,
    h2hFixtures
  ] = await Promise.all([
    apiFootballGet<ApiFootballEnvelope<Array<{ bookmakers: OddsBookmaker[] }>>>(
      "/odds",
      { fixture: fixtureId },
      120
    ).catch(() => ({ response: [], errors: [], results: 0 })),
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
        const payload = await apiFootballGet<ApiFootballEnvelope<FixtureSummary[]>>(
          "/fixtures/headtohead",
          { h2h: h2hKey }
        );
        caches.h2h.set(h2hKey, payload.response);
      }

      return caches.h2h.get(h2hKey) ?? [];
    })()
  ]);

  const bookmakers =
    oddsPayload.response[0]?.bookmakers?.map((bookmaker) => ({
      ...bookmaker,
      bets: bookmaker.bets.filter((bet) => MARKET_WHITELIST.has(bet.name))
    })) ?? [];

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

  for (const fixture of fixtures) {
    const cachedFixtureOffers = await readFixtureMarketEntries(
      fixture.fixture.id,
      dateKey,
      resolvedTimeZone
    );

    if (hasUsableSnapshot(cachedFixtureOffers)) {
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
        `Se guardaron mercados parciales para ${dateKey}. Fixtures pendientes: ${failures.join(" | ")}`,
        entries
      );
    }

    throw new SnapshotUnavailableError(
      `No se pudieron construir mercados para ${dateKey}. Fixtures pendientes: ${failures.join(" | ")}`
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
      `No se pudieron obtener mercados para el rango solicitado. ${failures.join(" | ")}`
    );
  }

  if (filteredEntries.length && failures.length) {
    throw new PartialMarketDataError(
      `Se muestran resultados parciales. Fechas no cargadas: ${failures.join(" | ")}`,
      filteredEntries
    );
  }

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

export async function loadSnapshotRange(params: {
  startDateKey: string;
  endDateKey: string;
  timeZone?: string;
}) {
  const resolvedTimeZone = params.timeZone ?? getDefaultTimeZone();
  const dates = enumerateDateKeys(params.startDateKey, params.endDateKey);
  const caches = {
    standings: new Map<string, StandingRow[]>(),
    teamStats: new Map<string, TeamStatistics | null>(),
    recentFixtures: new Map<string, FixtureSummary[]>(),
    h2h: new Map<string, FixtureSummary[]>()
  };
  const summary: Array<{
    dateKey: string;
    fixtures: number;
    marketEntries: number;
  }> = [];

  for (const dateKey of dates) {
    const fixtures = await fetchAndStoreFixturesByDate(dateKey, resolvedTimeZone);
    const entries = await buildAndStoreMarketEntriesByDate(dateKey, resolvedTimeZone, caches);

    summary.push({
      dateKey,
      fixtures: fixtures.length,
      marketEntries: entries.length
    });
  }

  return summary;
}
