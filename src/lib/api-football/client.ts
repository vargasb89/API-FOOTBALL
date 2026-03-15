import { getEnv } from "@/lib/config/env";
import { queryDb } from "@/lib/db";
import { getRedis } from "@/lib/redis";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const MIN_TTL_SECONDS = 60;
const memoryCache = new Map<string, CacheEntry>();

function buildCacheKey(path: string, params: Record<string, string | number>) {
  const search = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)])
  ).toString();

  return `api-football:${path}?${search}`;
}

async function readPersistentCache<T>(cacheKey: string): Promise<T | null> {
  const redis = getRedis();

  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  }

  const rows = await queryDb<{ response_json: T }>(
    "select response_json from api_cache where cache_key = $1 and expires_at > now()",
    [cacheKey]
  );

  return rows?.[0]?.response_json ?? null;
}

async function writePersistentCache<T>(
  cacheKey: string,
  value: T,
  ttlSeconds: number
) {
  const redis = getRedis();

  if (redis) {
    await redis.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
  }

  await queryDb(
    `insert into api_cache (cache_key, response_json, expires_at, updated_at)
     values ($1, $2::jsonb, now() + ($3 || ' seconds')::interval, now())
     on conflict (cache_key)
     do update set response_json = excluded.response_json,
                   expires_at = excluded.expires_at,
                   updated_at = now()`,
    [cacheKey, JSON.stringify(value), ttlSeconds]
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFootballGet<T>(
  path: string,
  params: Record<string, string | number>,
  ttlSeconds = MIN_TTL_SECONDS
): Promise<T> {
  const env = getEnv();
  const cacheKey = buildCacheKey(path, params);
  const inMemory = memoryCache.get(cacheKey);

  if (inMemory && inMemory.expiresAt > Date.now()) {
    return inMemory.value as T;
  }

  const persistent = await readPersistentCache<T>(cacheKey);
  if (persistent) {
    memoryCache.set(cacheKey, {
      value: persistent,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
    return persistent;
  }

  const url = new URL(`${env.API_FOOTBALL_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY
    },
    next: { revalidate: ttlSeconds }
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    await sleep(retryAfter * 1000);
    return apiFootballGet(path, params, ttlSeconds);
  }

  if (!response.ok) {
    throw new Error(`API-Football request failed: ${response.status}`);
  }

  const remaining = Number(response.headers.get("x-ratelimit-requests-remaining"));
  if (Number.isFinite(remaining) && remaining < 2) {
    await sleep(1500);
  }

  const payload = (await response.json()) as T;
  memoryCache.set(cacheKey, {
    value: payload,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
  await writePersistentCache(cacheKey, payload, Math.max(ttlSeconds, MIN_TTL_SECONDS));
  return payload;
}
