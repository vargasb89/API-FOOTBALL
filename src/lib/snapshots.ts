import { queryDb } from "@/lib/db";

export async function readDailySnapshot<T>(
  snapshotType: string,
  snapshotKey: string
): Promise<T | null> {
  const rows = await queryDb<{ payload: T }>(
    "select payload from daily_snapshots where snapshot_type = $1 and snapshot_key = $2",
    [snapshotType, snapshotKey]
  );

  return rows?.[0]?.payload ?? null;
}

export async function writeDailySnapshot<T>(
  snapshotType: string,
  snapshotKey: string,
  payload: T
) {
  await queryDb(
    `insert into daily_snapshots (snapshot_type, snapshot_key, payload, created_at, updated_at)
     values ($1, $2, $3::jsonb, now(), now())
     on conflict (snapshot_type, snapshot_key)
     do update set payload = excluded.payload,
                   updated_at = now()`,
    [snapshotType, snapshotKey, JSON.stringify(payload)]
  );
}
