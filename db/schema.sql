create table if not exists api_cache (
  cache_key text primary key,
  response_json jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists market_snapshots (
  id bigserial primary key,
  fixture_id bigint not null,
  market_name text not null,
  bookmaker_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_market_snapshots_fixture_id on market_snapshots (fixture_id);

create table if not exists daily_snapshots (
  snapshot_type text not null,
  snapshot_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (snapshot_type, snapshot_key)
);

create index if not exists idx_daily_snapshots_updated_at on daily_snapshots (updated_at desc);

create table if not exists model_cache (
  cache_type text not null,
  cache_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cache_type, cache_key)
);

create index if not exists idx_model_cache_updated_at on model_cache (updated_at desc);
