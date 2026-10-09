import type { SupabaseClient } from "@supabase/supabase-js";

export const SNAPSHOT_RETENTION_DAYS = 14;
export const SNAPSHOT_PURGE_BATCH_SIZE = 100;
export const SNAPSHOT_PURGE_BUDGET_MS = 20_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SNAPSHOT_PATH = new RegExp(`^snapshots/${UUID}/${UUID}/${UUID}\\.jpg$`, "i");

type ClaimedSnapshot = {
  out_event_id: string;
  out_snapshot_path: string;
  out_snapshot_captured_at: string;
};

type FinishRow = {
  out_deleted: number;
  out_released: number;
};

type StorageFile = { name: string };
type StorageErrorLike = {
  code?: string;
};

export type SnapshotPurgeResult = {
  eligible: number;
  deleted: number;
  failed: number;
  remaining: number;
  dry_run: boolean;
  /** Internal safe count for logging; API responses deliberately omit it. */
  invalid: number;
};

export class SnapshotPurgeConfigurationError extends Error {
  constructor() {
    super("snapshot_purge_configuration_invalid");
    this.name = "SnapshotPurgeConfigurationError";
  }
}

export class SnapshotPurgeOperationError extends Error {
  constructor(readonly operation: string) {
    super(`${operation}_failed`);
    this.name = "SnapshotPurgeOperationError";
  }
}

export function isSnapshotStoragePath(value: string): boolean {
  return SNAPSHOT_PATH.test(value);
}

function requireExactRetention(value: string | undefined): void {
  if (value?.trim() !== String(SNAPSHOT_RETENTION_DAYS)) {
    throw new SnapshotPurgeConfigurationError();
  }
}

function countValue(data: unknown, operation: string): number {
  const value = Array.isArray(data) ? data[0] : data;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SnapshotPurgeOperationError(operation);
  }
  return parsed;
}

function oneFinishRow(data: unknown): FinishRow {
  const row = (Array.isArray(data) ? data[0] : data) as Partial<FinishRow> | null;
  if (
    !row ||
    !Number.isSafeInteger(row.out_deleted) ||
    !Number.isSafeInteger(row.out_released) ||
    Number(row.out_deleted) < 0 ||
    Number(row.out_released) < 0
  ) {
    throw new SnapshotPurgeOperationError("snapshot_purge_finish");
  }
  return row as FinishRow;
}

function isMissingStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as StorageErrorLike).code ?? "").toLowerCase();
  return code === "nosuchkey" || code === "objectnotfound" || code === "object_not_found";
}

async function preview(client: SupabaseClient, examId?: string): Promise<number> {
  const { data, error } = await client.rpc("preview_snapshot_purge", {
    p_exam_id: examId ?? null,
  });
  if (error) throw new SnapshotPurgeOperationError("snapshot_purge_preview");
  return countValue(data, "snapshot_purge_preview");
}

async function claim(
  client: SupabaseClient,
  token: string,
  examId?: string,
): Promise<ClaimedSnapshot[]> {
  const { data, error } = await client.rpc("claim_snapshot_purge_batch", {
    p_claim_token: token,
    p_batch_size: SNAPSHOT_PURGE_BATCH_SIZE,
    p_exam_id: examId ?? null,
  });
  if (error || !Array.isArray(data)) {
    throw new SnapshotPurgeOperationError("snapshot_purge_claim");
  }
  return data as ClaimedSnapshot[];
}

async function finish(
  client: SupabaseClient,
  token: string,
  deleted: string[],
  failed: string[],
): Promise<FinishRow> {
  const { data, error } = await client.rpc("finish_snapshot_purge_batch", {
    p_claim_token: token,
    p_deleted_event_ids: deleted,
    p_failed_event_ids: failed,
  });
  if (error) throw new SnapshotPurgeOperationError("snapshot_purge_finish");
  return oneFinishRow(data);
}

async function removeClaimed(
  client: SupabaseClient,
  claimed: ClaimedSnapshot[],
): Promise<{ deleted: string[]; failed: string[] }> {
  if (!claimed.length) return { deleted: [], failed: [] };
  const bucket = client.storage.from("snapshots");
  const paths = claimed.map((item) => item.out_snapshot_path);
  let response: { data: StorageFile[] | null; error: unknown };
  try {
    response = await bucket.remove(paths) as typeof response;
  } catch {
    return { deleted: [], failed: claimed.map((item) => item.out_event_id) };
  }

  if (response.error && !isMissingStorageError(response.error)) {
    return { deleted: [], failed: claimed.map((item) => item.out_event_id) };
  }

  const confirmedPaths = new Set(
    (response.data ?? [])
      .map((item) => item.name)
      .filter((name) => paths.includes(name)),
  );
  const unconfirmed = claimed.filter((item) => !confirmedPaths.has(item.out_snapshot_path));
  const checked = await Promise.all(unconfirmed.map(async (item) => {
    try {
      const result = await bucket.exists(item.out_snapshot_path);
      return {
        id: item.out_event_id,
        absent: result.data === false && (!result.error || isMissingStorageError(result.error)),
      };
    } catch {
      return { id: item.out_event_id, absent: false };
    }
  }));
  const absentIds = new Set(checked.filter((item) => item.absent).map((item) => item.id));
  const deleted = claimed
    .filter((item) => confirmedPaths.has(item.out_snapshot_path) || absentIds.has(item.out_event_id))
    .map((item) => item.out_event_id);
  const deletedSet = new Set(deleted);
  return {
    deleted,
    failed: claimed.filter((item) => !deletedSet.has(item.out_event_id)).map((item) => item.out_event_id),
  };
}

export async function runSnapshotPurge({
  client,
  dryRun,
  examId,
  retentionDays,
  now = Date.now,
  randomUUID = () => crypto.randomUUID(),
  onInvalidPaths,
}: {
  client: SupabaseClient;
  dryRun: boolean;
  examId?: string;
  retentionDays: string | undefined;
  now?: () => number;
  randomUUID?: () => string;
  onInvalidPaths?: (count: number) => void;
}): Promise<SnapshotPurgeResult> {
  requireExactRetention(retentionDays);
  const eligible = await preview(client, examId);
  if (dryRun || eligible === 0) {
    return { eligible, deleted: 0, failed: 0, remaining: eligible, dry_run: dryRun, invalid: 0 };
  }

  const startedAt = now();
  let deleted = 0;
  let failed = 0;
  let invalid = 0;

  while (now() - startedAt < SNAPSHOT_PURGE_BUDGET_MS) {
    const token = randomUUID();
    const rows = await claim(client, token, examId);
    if (!rows.length) break;

    const valid = rows.filter((item) => isSnapshotStoragePath(item.out_snapshot_path));
    const invalidRows = rows.filter((item) => !isSnapshotStoragePath(item.out_snapshot_path));
    invalid += invalidRows.length;
    if (invalidRows.length) onInvalidPaths?.(invalidRows.length);

    const storage = await removeClaimed(client, valid);
    const deletedIds = storage.deleted;
    const failedIds = [...invalidRows.map((item) => item.out_event_id), ...storage.failed];
    const completed = await finish(client, token, deletedIds, failedIds);
    deleted += completed.out_deleted;
    failed += completed.out_released;

    // Released work would be claimed again immediately. Leave it durable for a
    // later manual run/worker tick instead of retrying it in a tight loop.
    if (failedIds.length || rows.length < SNAPSHOT_PURGE_BATCH_SIZE) break;
  }

  const remaining = await preview(client, examId);
  return { eligible, deleted, failed, remaining, dry_run: false, invalid };
}
