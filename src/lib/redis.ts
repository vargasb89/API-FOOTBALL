import Redis from "ioredis";

import { getEnv } from "@/lib/config/env";

let redis: Redis | null = null;

export function getRedis() {
  const env = getEnv();

  if (!env.REDIS_URL) {
    return null;
  }

  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
  }

  return redis;
}
