import { Pool, type QueryResultRow } from "pg";

import { getEnv } from "@/lib/config/env";

let pool: Pool | null = null;

export function getDbPool() {
  const env = getEnv();

  if (!env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL
    });
  }

  return pool;
}

export async function queryDb<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[] | null> {
  const db = getDbPool();

  if (!db) {
    return null;
  }

  const result = await db.query<T>(text, values);
  return result.rows;
}
