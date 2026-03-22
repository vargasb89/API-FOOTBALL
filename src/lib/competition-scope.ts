export type LeagueCategory =
  | "Principales"
  | "Secundarias"
  | "Ineficiencias"
  | "Goles"
  | "America"
  | "AsiaOceania";

export type TrackedLeague = {
  country: string;
  name: string;
  label: string;
  categories: LeagueCategory[];
};

export type LeagueProfile = {
  baselineHomeGoals: number;
  baselineAwayGoals: number;
  homeAdvantage: number;
  overBias: number;
  over15Bias: number;
  bttsBias: number;
  totalGoalsLean: number;
  rho: number;
};

export const TRACKED_LEAGUES: TrackedLeague[] = [
  {
    country: "England",
    name: "Premier League",
    label: "England Premier League",
    categories: ["Principales"]
  },
  {
    country: "Spain",
    name: "La Liga",
    label: "Spain La Liga",
    categories: ["Principales"]
  },
  {
    country: "Germany",
    name: "Bundesliga",
    label: "Germany Bundesliga",
    categories: ["Principales"]
  },
  {
    country: "Italy",
    name: "Serie A",
    label: "Italy Serie A",
    categories: ["Principales"]
  },
  {
    country: "France",
    name: "Ligue 1",
    label: "France Ligue 1",
    categories: ["Principales"]
  },
  {
    country: "World",
    name: "UEFA Champions League",
    label: "UEFA Champions League",
    categories: ["Principales"]
  },
  {
    country: "World",
    name: "UEFA Europa League",
    label: "UEFA Europa League",
    categories: ["Principales"]
  },
  {
    country: "England",
    name: "Championship",
    label: "England Championship",
    categories: ["Secundarias"]
  },
  {
    country: "Spain",
    name: "Segunda Division",
    label: "Spain Segunda Division",
    categories: ["Secundarias"]
  },
  {
    country: "Germany",
    name: "2. Bundesliga",
    label: "Germany Bundesliga 2",
    categories: ["Secundarias"]
  },
  {
    country: "Italy",
    name: "Serie B",
    label: "Italy Serie B",
    categories: ["Secundarias"]
  },
  {
    country: "Netherlands",
    name: "Eredivisie",
    label: "Netherlands Eredivisie",
    categories: ["Secundarias", "Goles"]
  },
  {
    country: "Belgium",
    name: "Jupiler Pro League",
    label: "Belgium Pro League",
    categories: ["Secundarias", "Goles"]
  },
  {
    country: "Portugal",
    name: "Primeira Liga",
    label: "Portugal Primeira Liga",
    categories: ["Secundarias"]
  },
  {
    country: "Sweden",
    name: "Allsvenskan",
    label: "Sweden Allsvenskan",
    categories: ["Ineficiencias"]
  },
  {
    country: "Norway",
    name: "Eliteserien",
    label: "Norway Eliteserien",
    categories: ["Ineficiencias"]
  },
  {
    country: "Denmark",
    name: "Superliga",
    label: "Denmark Superliga",
    categories: ["Ineficiencias"]
  },
  {
    country: "Poland",
    name: "Ekstraklasa",
    label: "Poland Ekstraklasa",
    categories: ["Ineficiencias"]
  },
  {
    country: "Czech-Republic",
    name: "Czech Liga",
    label: "Czech First League",
    categories: ["Ineficiencias"]
  },
  {
    country: "Romania",
    name: "Liga I",
    label: "Romania Liga 1",
    categories: ["Ineficiencias"]
  },
  {
    country: "Croatia",
    name: "HNL",
    label: "Croatia HNL",
    categories: ["Ineficiencias"]
  },
  {
    country: "Austria",
    name: "Bundesliga",
    label: "Austria Bundesliga",
    categories: ["Goles"]
  },
  {
    country: "Switzerland",
    name: "Super League",
    label: "Switzerland Super League",
    categories: ["Goles"]
  },
  {
    country: "Brazil",
    name: "Serie A",
    label: "Brazil Serie A",
    categories: ["America"]
  },
  {
    country: "Argentina",
    name: "Primera Division",
    label: "Argentina Primera Division",
    categories: ["America"]
  },
  {
    country: "Colombia",
    name: "Primera A",
    label: "Colombia Primera A",
    categories: ["America"]
  },
  {
    country: "Chile",
    name: "Primera Division",
    label: "Chile Primera Division",
    categories: ["America"]
  },
  {
    country: "USA",
    name: "Major League Soccer",
    label: "MLS",
    categories: ["America"]
  },
  {
    country: "Japan",
    name: "J1 League",
    label: "Japan J League",
    categories: ["AsiaOceania"]
  },
  {
    country: "South-Korea",
    name: "K League 1",
    label: "South Korea K League",
    categories: ["AsiaOceania"]
  },
  {
    country: "China",
    name: "Super League",
    label: "China Super League",
    categories: ["AsiaOceania"]
  },
  {
    country: "Australia",
    name: "A-League",
    label: "Australia A-League",
    categories: ["AsiaOceania"]
  }
];

export const LEAGUE_CATEGORY_LABELS: Record<LeagueCategory, string> = {
  Principales: "Ligas principales",
  Secundarias: "Ligas secundarias de alto volumen",
  Ineficiencias: "Ligas con mayor probabilidad de ineficiencia",
  Goles: "Ligas con alto promedio de goles",
  America: "Ligas de America",
  AsiaOceania: "Ligas de Asia y Oceania"
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findTrackedLeague(country: string, name: string) {
  const normalizedCountry = normalize(country);
  const normalizedName = normalize(name);

  return TRACKED_LEAGUES.find(
    (league) =>
      normalize(league.country) === normalizedCountry &&
      normalize(league.name) === normalizedName
  );
}

export function isTrackedLeague(country: string, name: string) {
  return Boolean(findTrackedLeague(country, name));
}

export function getLeagueGroups() {
  return Object.entries(LEAGUE_CATEGORY_LABELS).map(([key, label]) => ({
    key: key as LeagueCategory,
    label,
    leagues: TRACKED_LEAGUES.filter((league) => league.categories.includes(key as LeagueCategory))
  }));
}

export function getLeagueProfile(country: string, name: string): LeagueProfile {
  const league = findTrackedLeague(country, name);
  const categories = league?.categories ?? ["Secundarias"];

  if (categories.includes("Goles")) {
    return {
      baselineHomeGoals: 1.74,
      baselineAwayGoals: 1.36,
      homeAdvantage: 1.05,
      overBias: 1.08,
      over15Bias: 1.14,
      bttsBias: 1.07,
      totalGoalsLean: 1.08,
      rho: -0.015
    };
  }

  if (categories.includes("AsiaOceania")) {
    return {
      baselineHomeGoals: 1.64,
      baselineAwayGoals: 1.28,
      homeAdvantage: 1.05,
      overBias: 1.07,
      over15Bias: 1.12,
      bttsBias: 1.05,
      totalGoalsLean: 1.06,
      rho: -0.02
    };
  }

  if (categories.includes("America")) {
    return {
      baselineHomeGoals: 1.5,
      baselineAwayGoals: 1.14,
      homeAdvantage: 1.07,
      overBias: 1.03,
      over15Bias: 1.08,
      bttsBias: 1.01,
      totalGoalsLean: 1.03,
      rho: -0.02
    };
  }

  if (categories.includes("Ineficiencias")) {
    return {
      baselineHomeGoals: 1.54,
      baselineAwayGoals: 1.18,
      homeAdvantage: 1.06,
      overBias: 1.05,
      over15Bias: 1.1,
      bttsBias: 1.03,
      totalGoalsLean: 1.05,
      rho: -0.02
    };
  }

  if (categories.includes("Principales")) {
    return {
      baselineHomeGoals: 1.6,
      baselineAwayGoals: 1.24,
      homeAdvantage: 1.05,
      overBias: 1.04,
      over15Bias: 1.09,
      bttsBias: 1.02,
      totalGoalsLean: 1.04,
      rho: -0.02
    };
  }

  return {
    baselineHomeGoals: 1.56,
    baselineAwayGoals: 1.2,
    homeAdvantage: 1.05,
    overBias: 1.03,
    over15Bias: 1.08,
    bttsBias: 1.02,
    totalGoalsLean: 1.04,
    rho: -0.02
  };
}
