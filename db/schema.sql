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
