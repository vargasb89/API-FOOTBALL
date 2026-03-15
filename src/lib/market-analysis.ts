import { getLeagueProfile } from "@/lib/competition-scope";
import type {
  FixtureSummary,
  OddsBookmaker,
  StandingRow,
  TeamStatistics
} from "@/lib/api-football/types";
import { calculateValueBet } from "@/lib/value";

export type MarketKey =
  | "BTTS_YES"
  | "OVER_1_5"
  | "OVER_2_5"
  | "OVER_3_5"
  | "UNDER_3_5"
  | "HOME_OVER_1_5"
  | "AWAY_OVER_1_5";

export type ModelProbabilities = Record<MarketKey, number>;

export type MarketOffer = {
  key: MarketKey;
  label: string;
  marketName: string;
  bookmaker: string;
  odds: number;
  impliedProbability: number;
  modeledProbability: number;
  edge: number;
  expectedValue: number;
  confidence: number;
};

export type MarketLeaderboardEntry = {
  fixture: FixtureSummary;
  offer: MarketOffer;
};

type RecentMetrics = {
  scored: number;
  conceded: number;
  pointsPerMatch: number;
  totalGoals: number;
};

type MarketModelInput = {
  fixture: FixtureSummary;
  homeStats: TeamStatistics | null;
  awayStats: TeamStatistics | null;
  homeRecentFixtures: FixtureSummary[];
  awayRecentFixtures: FixtureSummary[];
  h2hFixtures: FixtureSummary[];
  standings: StandingRow[];
};

export const REQUESTED_MARKETS: MarketKey[] = [
  "BTTS_YES",
  "OVER_1_5",
  "OVER_2_5",
  "OVER_3_5",
  "UNDER_3_5",
  "HOME_OVER_1_5",
  "AWAY_OVER_1_5"
];

const LABELS: Record<MarketKey, string> = {
  BTTS_YES: "BTTS",
  OVER_1_5: "Over 1.5",
  OVER_2_5: "Over 2.5",
  OVER_3_5: "Over 3.5",
  UNDER_3_5: "Under 3.5",
  HOME_OVER_1_5: "Home Team Over 1.5",
  AWAY_OVER_1_5: "Away Team Over 1.5"
};

function toNumber(value: string | number | undefined | null, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function weightedAverage(values: number[]) {
  if (!values.length) {
    return 0;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  values.forEach((value, index) => {
    const weight = 0.92 ** index;
    weightedSum += value * weight;
    totalWeight += weight;
  });

  return totalWeight ? weightedSum / totalWeight : 0;
}

function getRecentMetrics(teamId: number, fixtures: FixtureSummary[]): RecentMetrics {
  if (!fixtures.length) {
    return {
      scored: 0,
      conceded: 0,
      pointsPerMatch: 0,
      totalGoals: 0
    };
  }

  const scoredValues: number[] = [];
  const concededValues: number[] = [];
  const pointsValues: number[] = [];

  fixtures.forEach((fixture) => {
    const isHome = fixture.teams.home.id === teamId;
    const scored = isHome ? fixture.goals.home ?? 0 : fixture.goals.away ?? 0;
    const conceded = isHome ? fixture.goals.away ?? 0 : fixture.goals.home ?? 0;
    const points = scored > conceded ? 3 : scored === conceded ? 1 : 0;

    scoredValues.push(scored);
    concededValues.push(conceded);
    pointsValues.push(points);
  });

  return {
    scored: weightedAverage(scoredValues),
    conceded: weightedAverage(concededValues),
    pointsPerMatch: weightedAverage(pointsValues),
    totalGoals: weightedAverage(
      scoredValues.map((scored, index) => scored + (concededValues[index] ?? 0))
    )
  };
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getStandingStrength(teamId: number, standings: StandingRow[]) {
  const standing = standings.find((row) => row.team.id === teamId);

  if (!standing || standing.all.played === 0) {
    return 0;
  }

  const pointsPerGame = standing.points / standing.all.played;
  return clamp((pointsPerGame - 1.35) * 0.12, -0.18, 0.18);
}

function factorial(value: number) {
  if (value <= 1) {
    return 1;
  }

  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }

  return result;
}

function poissonProbability(lambda: number, goals: number) {
  return (Math.exp(-lambda) * lambda ** goals) / factorial(goals);
}

function dixonColesAdjustment(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
) {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }

  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }

  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }

  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }

  return 1;
}

function normalizeProbability(value: number, bias = 1) {
  return clamp(value * bias, 0, 0.98);
}

function blendProbability(base: number, target: number, weight: number) {
  return clamp(base * (1 - weight) + target * weight, 0, 0.98);
}

function getMarketConfidence({
  key,
  edge,
  modeledProbability
}: {
  key: MarketKey;
  edge: number;
  modeledProbability: number;
}) {
  const edgeScore = clamp((edge + 0.02) / 0.12, 0, 1);
  const centralityPenalty = Math.abs(modeledProbability - 0.5);
  const probabilityScore = 1 - clamp(centralityPenalty / 0.5, 0, 1) * 0.55;
  const marketBoost =
    key === "BTTS_YES" || key === "OVER_2_5" || key === "OVER_3_5" ? 0.08 : 0;

  return clamp(edgeScore * 0.55 + probabilityScore * 0.45 + marketBoost, 0, 1);
}

export function getConfidenceLabel(confidence: number) {
  if (confidence >= 0.78) {
    return "Alta";
  }

  if (confidence >= 0.58) {
    return "Media";
  }

  return "Baja";
}

export function buildProbabilityModel({
  fixture,
  homeStats,
  awayStats,
  homeRecentFixtures,
  awayRecentFixtures,
  h2hFixtures,
  standings
}: MarketModelInput): ModelProbabilities {
  const profile = getLeagueProfile(fixture.league.country, fixture.league.name);
  const homeId = fixture.teams.home.id;
  const awayId = fixture.teams.away.id;

  const homeSeasonFor = toNumber(homeStats?.goals?.for?.average?.home, profile.baselineHomeGoals);
  const homeSeasonAgainst = toNumber(
    homeStats?.goals?.against?.average?.home,
    profile.baselineAwayGoals
  );
  const awaySeasonFor = toNumber(awayStats?.goals?.for?.average?.away, profile.baselineAwayGoals);
  const awaySeasonAgainst = toNumber(
    awayStats?.goals?.against?.average?.away,
    profile.baselineHomeGoals
  );

  const homeRecent = getRecentMetrics(homeId, homeRecentFixtures.slice(0, 20));
  const awayRecent = getRecentMetrics(awayId, awayRecentFixtures.slice(0, 20));
  const h2hHomeAvg = average(
    h2hFixtures.slice(0, 6).map((item) =>
      item.teams.home.id === homeId ? item.goals.home ?? 0 : item.goals.away ?? 0
    )
  );
  const h2hAwayAvg = average(
    h2hFixtures.slice(0, 6).map((item) =>
      item.teams.home.id === awayId ? item.goals.home ?? 0 : item.goals.away ?? 0
    )
  );
  const standingDelta =
    getStandingStrength(homeId, standings) - getStandingStrength(awayId, standings);

  const homeAttackIndex = clamp(
    homeSeasonFor / profile.baselineHomeGoals,
    0.68,
    1.6
  );
  const awayAttackIndex = clamp(
    awaySeasonFor / profile.baselineAwayGoals,
    0.68,
    1.6
  );
  const homeDefenseWeakness = clamp(
    homeSeasonAgainst / profile.baselineAwayGoals,
    0.7,
    1.55
  );
  const awayDefenseWeakness = clamp(
    awaySeasonAgainst / profile.baselineHomeGoals,
    0.7,
    1.55
  );
  const homeRecentAttack = clamp(
    homeRecent.scored / profile.baselineHomeGoals || 1,
    0.65,
    1.7
  );
  const awayRecentAttack = clamp(
    awayRecent.scored / profile.baselineAwayGoals || 1,
    0.65,
    1.7
  );
  const homeRecentDefense = clamp(
    homeRecent.conceded / profile.baselineAwayGoals || 1,
    0.65,
    1.65
  );
  const awayRecentDefense = clamp(
    awayRecent.conceded / profile.baselineHomeGoals || 1,
    0.65,
    1.65
  );
  const homeH2HIndex = h2hHomeAvg ? clamp(h2hHomeAvg / profile.baselineHomeGoals, 0.78, 1.28) : 1;
  const awayH2HIndex = h2hAwayAvg ? clamp(h2hAwayAvg / profile.baselineAwayGoals, 0.78, 1.28) : 1;
  const homeFormIndex = clamp(1 + (homeRecent.pointsPerMatch - 1.35) * 0.05, 0.92, 1.12);
  const awayFormIndex = clamp(1 + (awayRecent.pointsPerMatch - 1.25) * 0.05, 0.92, 1.12);
  const homeTempoIndex = clamp(
    (homeRecent.totalGoals || profile.baselineHomeGoals + profile.baselineAwayGoals) /
      (profile.baselineHomeGoals + profile.baselineAwayGoals),
    0.82,
    1.28
  );
  const awayTempoIndex = clamp(
    (awayRecent.totalGoals || profile.baselineHomeGoals + profile.baselineAwayGoals) /
      (profile.baselineHomeGoals + profile.baselineAwayGoals),
    0.82,
    1.28
  );
  const attackingEnvironment = clamp((homeTempoIndex + awayTempoIndex) / 2, 0.86, 1.24);

  const lambdaHome = clamp(
    profile.baselineHomeGoals *
      profile.homeAdvantage *
      (homeAttackIndex * 0.46 +
        homeRecentAttack * 0.28 +
        homeH2HIndex * 0.08 +
        homeFormIndex * 0.08) *
      (awayDefenseWeakness * 0.46 + awayRecentDefense * 0.24 + 0.3) *
      attackingEnvironment *
      (1 + standingDelta * 0.65),
    0.55,
    3.95
  );

  const lambdaAway = clamp(
    profile.baselineAwayGoals *
      (awayAttackIndex * 0.46 +
        awayRecentAttack * 0.28 +
        awayH2HIndex * 0.08 +
        awayFormIndex * 0.08) *
      (homeDefenseWeakness * 0.46 + homeRecentDefense * 0.24 + 0.3) *
      attackingEnvironment *
      (1 - standingDelta * 0.42),
    0.45,
    3.65
  );

  const baselineTotalGoals = profile.baselineHomeGoals + profile.baselineAwayGoals;
  const recentTotalGoals = average([homeRecent.totalGoals, awayRecent.totalGoals].filter(Boolean));
  const h2hTotalGoals = average(
    h2hFixtures
      .slice(0, 6)
      .map((item) => (item.goals.home ?? 0) + (item.goals.away ?? 0))
      .filter((value) => Number.isFinite(value))
  );
  const scoringEnvironment = clamp(
    average(
      [
        lambdaHome + lambdaAway,
        baselineTotalGoals,
        recentTotalGoals || baselineTotalGoals,
        h2hTotalGoals || baselineTotalGoals
      ].filter((value) => value > 0)
    ) * profile.totalGoalsLean,
    1.8,
    4.6
  );

  let bttsYes = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let under35 = 0;
  let homeOver15 = 0;
  let awayOver15 = 0;

  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) {
      const probability =
        poissonProbability(lambdaHome, homeGoals) *
        poissonProbability(lambdaAway, awayGoals) *
        dixonColesAdjustment(homeGoals, awayGoals, lambdaHome, lambdaAway, profile.rho);

      if (homeGoals > 0 && awayGoals > 0) {
        bttsYes += probability;
      }

      const totalGoals = homeGoals + awayGoals;
      if (totalGoals > 1.5) over15 += probability;
      if (totalGoals > 2.5) over25 += probability;
      if (totalGoals > 3.5) over35 += probability;
      if (totalGoals < 3.5) under35 += probability;
      if (homeGoals > 1.5) homeOver15 += probability;
      if (awayGoals > 1.5) awayOver15 += probability;
    }
  }

  const directOver15 = clamp(1 - Math.exp(-scoringEnvironment) * (1 + scoringEnvironment), 0, 0.985);
  const directOver25 = clamp(
    1 -
      Math.exp(-scoringEnvironment) *
        (1 + scoringEnvironment + scoringEnvironment ** 2 / 2),
    0,
    0.96
  );
  const directOver35 = clamp(
    1 -
      Math.exp(-scoringEnvironment) *
        (1 +
          scoringEnvironment +
          scoringEnvironment ** 2 / 2 +
          scoringEnvironment ** 3 / 6),
    0,
    0.9
  );
  const directUnder35 = clamp(
    Math.exp(-scoringEnvironment) *
      (1 +
        scoringEnvironment +
        scoringEnvironment ** 2 / 2 +
        scoringEnvironment ** 3 / 6),
    0.1,
    0.98
  );
  const directBttsYes = clamp(
    1 - Math.exp(-lambdaHome) - Math.exp(-lambdaAway) + Math.exp(-(lambdaHome + lambdaAway)),
    0,
    0.92
  );
  const directHomeOver15 = clamp(
    1 - Math.exp(-lambdaHome) * (1 + lambdaHome),
    0,
    0.92
  );
  const directAwayOver15 = clamp(
    1 - Math.exp(-lambdaAway) * (1 + lambdaAway),
    0,
    0.9
  );

  return {
    BTTS_YES: normalizeProbability(
      blendProbability(bttsYes, directBttsYes, 0.42),
      profile.bttsBias
    ),
    OVER_1_5: normalizeProbability(
      blendProbability(over15, directOver15, 0.72),
      profile.over15Bias
    ),
    OVER_2_5: normalizeProbability(
      blendProbability(over25, directOver25, 0.48),
      profile.overBias
    ),
    OVER_3_5: normalizeProbability(
      blendProbability(over35, directOver35, 0.34),
      profile.overBias
    ),
    UNDER_3_5: normalizeProbability(
      blendProbability(under35, directUnder35, 0.2),
      2 - profile.overBias
    ),
    HOME_OVER_1_5: normalizeProbability(
      blendProbability(homeOver15, directHomeOver15, 0.42),
      profile.homeAdvantage * 1.02
    ),
    AWAY_OVER_1_5: normalizeProbability(
      blendProbability(awayOver15, directAwayOver15, 0.42),
      1 / (profile.homeAdvantage * 0.98)
    )
  };
}

function getMarketKey(marketName: string, selectionValue: string): MarketKey | null {
  const value = selectionValue.toLowerCase();

  if (marketName === "Goals Over/Under") {
    if (value === "over 1.5") return "OVER_1_5";
    if (value === "over 2.5") return "OVER_2_5";
    if (value === "over 3.5") return "OVER_3_5";
    if (value === "under 3.5") return "UNDER_3_5";
  }

  if (marketName === "Both Teams Score" && value === "yes") {
    return "BTTS_YES";
  }

  if (marketName === "Home Team Over/Under" && value === "over 1.5") {
    return "HOME_OVER_1_5";
  }

  if (marketName === "Away Team Over/Under" && value === "over 1.5") {
    return "AWAY_OVER_1_5";
  }

  return null;
}

export function extractBestMarketOffers(
  bookmakers: OddsBookmaker[],
  modelProbabilities: ModelProbabilities
): MarketOffer[] {
  const best = new Map<MarketKey, MarketOffer>();

  for (const bookmaker of bookmakers) {
    for (const bet of bookmaker.bets) {
      for (const value of bet.values) {
        const key = getMarketKey(bet.name, value.value);

        if (!key) {
          continue;
        }

        const odds = toNumber(value.odd);
        if (!odds || odds <= 1) {
          continue;
        }

        const analysis = calculateValueBet({
          bookmakerOdds: odds,
          estimatedProbability: modelProbabilities[key]
        });

        const offer: MarketOffer = {
          key,
          label: LABELS[key],
          marketName: bet.name,
          bookmaker: bookmaker.name,
          odds,
          impliedProbability: analysis.impliedProbability,
          modeledProbability: modelProbabilities[key],
          edge: analysis.edge,
          expectedValue: analysis.expectedValue,
          confidence: getMarketConfidence({
            key,
            edge: analysis.edge,
            modeledProbability: modelProbabilities[key]
          })
        };

        const current = best.get(key);
        if (!current || offer.odds > current.odds) {
          best.set(key, offer);
        }
      }
    }
  }

  return [...best.values()].sort((left, right) => right.edge - left.edge);
}

export function groupOffersByMarket(entries: MarketLeaderboardEntry[]) {
  return REQUESTED_MARKETS.map((market) => ({
    market,
    label: LABELS[market],
    entries: entries
      .filter((entry) => entry.offer.key === market && entry.offer.edge > 0)
      .sort((left, right) => right.offer.edge - left.offer.edge)
  }));
}

export function groupModelProbabilitiesByMarket(entries: MarketLeaderboardEntry[]) {
  return REQUESTED_MARKETS.map((market) => ({
    market,
    label: LABELS[market],
    entries: entries
      .filter((entry) => entry.offer.key === market)
      .sort(
        (left, right) =>
          right.offer.modeledProbability - left.offer.modeledProbability ||
          right.offer.edge - left.offer.edge
      )
  }));
}
