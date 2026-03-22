import { queryDb } from "@/lib/db";

export async function readModelCache<T>(cacheType: string, cacheKey: string) {
  const rows = await queryDb<{ payload: T }>(
    "select payload from model_cache where cache_type = $1 and cache_key = $2",
    [cacheType, cacheKey]
  );

  return rows?.[0]?.payload ?? null;
}

export async function writeModelCache<T>(
  cacheType: string,
  cacheKey: string,
  payload: T
) {
  await queryDb(
    `insert into model_cache (cache_type, cache_key, payload, created_at, updated_at)
     values ($1, $2, $3::jsonb, now(), now())
     on conflict (cache_type, cache_key)
     do update set payload = excluded.payload,
                   updated_at = now()`,
    [cacheType, cacheKey, JSON.stringify(payload)]
  );
}
