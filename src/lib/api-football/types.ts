export type ApiFootballEnvelope<T> = {
  errors: unknown[];
  results: number;
  response: T;
};

export type FixtureSummary = {
  fixture: {
    id: number;
    date: string;
    venue?: { name?: string };
    status: { short: string; elapsed?: number };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo?: string;
    round?: string;
    season: number;
  };
  teams: {
    home: { id: number; name: string; logo?: string; winner?: boolean };
    away: { id: number; name: string; logo?: string; winner?: boolean };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score?: {
    fulltime?: { home: number | null; away: number | null };
  };
};

export type FixtureStatisticsRow = {
  team: { id: number; name: string; logo?: string };
  statistics: Array<{
    type: string;
    value: string | number | null;
  }>;
};

export type TeamStatistics = {
  league: { id: number; name: string; season: number };
  team: { id: number; name: string; logo?: string };
  form?: string;
  fixtures?: {
    played?: { home?: number; away?: number; total?: number };
    wins?: { home?: number; away?: number; total?: number };
    draws?: { home?: number; away?: number; total?: number };
    loses?: { home?: number; away?: number; total?: number };
  };
  goals?: {
    for?: {
      total?: { home?: number; away?: number; total?: number };
      average?: { home?: string; away?: string; total?: string };
    };
    against?: {
      total?: { home?: number; away?: number; total?: number };
      average?: { home?: string; away?: string; total?: string };
    };
  };
};

export type StandingRow = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  points: number;
  goalsDiff: number;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  form?: string;
};

export type OddsBookmaker = {
  id: number;
  name: string;
  bets: Array<{
    id: number;
    name: string;
    values: Array<{ value: string; odd: string }>;
  }>;
};
