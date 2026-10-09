import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SNAPSHOT_PURGE_BATCH_SIZE,
  SnapshotPurgeConfigurationError,
  isSnapshotStoragePath,
  runSnapshotPurge,
} from "./snapshot-purge";

const examId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";
const path = (id = eventId) => `snapshots/${examId}/${attemptId}/${id}.jpg`;

function clientWith(rpc: ReturnType<typeof vi.fn>, bucket: Record<string, unknown> = {}) {
  return {
    rpc,
    storage: { from: vi.fn(() => bucket) },
  } as unknown as SupabaseClient;
}

describe("snapshot purge orchestrator", () => {
  it("accepts only the complete stored snapshot key shape", () => {
    expect(isSnapshotStoragePath(path())).toBe(true);
    expect(isSnapshotStoragePath(`../${path()}`)).toBe(false);
    expect(isSnapshotStoragePath(`question-images/${examId}/${attemptId}/${eventId}.jpg`)).toBe(false);
    expect(isSnapshotStoragePath(`other/${examId}/${attemptId}/${eventId}.jpg`)).toBe(false);
  });

  it("rejects missing or non-14-day retention before any database or Storage call", async () => {
    for (const configured of [undefined, "", "0", "13", "14.0", "fourteen"]) {
      const rpc = vi.fn();
      const client = clientWith(rpc);
      await expect(runSnapshotPurge({ client, dryRun: true, retentionDays: configured }))
        .rejects.toBeInstanceOf(SnapshotPurgeConfigurationError);
      expect(rpc).not.toHaveBeenCalled();
      expect(client.storage.from).not.toHaveBeenCalled();
    }
  });

  it("previews without claiming or touching Storage", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });
    const client = clientWith(rpc);
    await expect(runSnapshotPurge({ client, dryRun: true, examId, retentionDays: "14" }))
      .resolves.toEqual({ eligible: 7, deleted: 0, failed: 0, remaining: 7, dry_run: true, invalid: 0 });
    expect(rpc).toHaveBeenCalledWith("preview_snapshot_purge", { p_exam_id: examId });
    expect(client.storage.from).not.toHaveBeenCalled();
  });

  it("reconciles partial removal, treats a missing object as success, and releases failures", async () => {
    const eventA = "00000000-0000-4000-8000-000000000003";
    const eventB = "00000000-0000-4000-8000-000000000004";
    const eventC = "00000000-0000-4000-8000-000000000005";
    const pathA = path(eventA);
    const pathB = path(eventB);
    const pathC = path(eventC);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({ data: [
        { out_event_id: eventA, out_snapshot_path: pathA, out_snapshot_captured_at: "2026-09-01T00:00:00Z" },
        { out_event_id: eventB, out_snapshot_path: pathB, out_snapshot_captured_at: "2026-09-01T00:00:00Z" },
        { out_event_id: eventC, out_snapshot_path: pathC, out_snapshot_captured_at: "2026-09-01T00:00:00Z" },
      ], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 2, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const remove = vi.fn().mockResolvedValue({ data: [{ name: pathA }], error: null });
    const exists = vi.fn()
      .mockResolvedValueOnce({ data: false, error: { status: 404, code: "NoSuchKey" } })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = clientWith(rpc, { remove, exists });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      examId,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
      now: (() => { let value = 0; return () => value++; })(),
    });

    expect(remove).toHaveBeenCalledWith([pathA, pathB, pathC]);
    expect(exists).toHaveBeenNthCalledWith(1, pathB);
    expect(exists).toHaveBeenNthCalledWith(2, pathC);
    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", {
      p_claim_token: "00000000-0000-4000-8000-000000000099",
      p_deleted_event_ids: [eventA, eventB],
      p_failed_event_ids: [eventC],
    });
    expect(result).toEqual({ eligible: 3, deleted: 2, failed: 1, remaining: 1, dry_run: false, invalid: 0 });
  });

  it("never sends hostile keys to Storage and reports them as failed", async () => {
    const hostile = `../question-images/${eventId}.jpg`;
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: hostile, out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 0, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const remove = vi.fn();
    const invalid = vi.fn();
    const client = clientWith(rpc, { remove, exists: vi.fn() });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
      onInvalidPaths: invalid,
    });

    expect(remove).not.toHaveBeenCalled();
    expect(invalid).toHaveBeenCalledWith(1);
    expect(result.failed).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it("treats a Storage object-not-found removal response as successful", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 1, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    const exists = vi.fn().mockResolvedValue({ data: false, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: null, error: { status: 404, code: "NoSuchKey" } }),
      exists,
    });
    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });
    expect(result).toMatchObject({ deleted: 1, failed: 0, remaining: 0 });
    expect(exists).toHaveBeenCalledWith(path());
  });

  it("does not mistake a missing Storage bucket for an absent object", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 0, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: null, error: { status: 404, code: "NoSuchBucket" } }),
      exists: vi.fn(),
    });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(result).toMatchObject({ deleted: 0, failed: 1, remaining: 1 });
    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", expect.objectContaining({
      p_deleted_event_ids: [],
      p_failed_event_ids: [eventId],
    }));
  });

  it("does not clear a reference when the Storage existence check itself fails", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 0, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      exists: vi.fn().mockResolvedValue({ data: false, error: { code: "NoSuchBucket" } }),
    });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(result).toMatchObject({ deleted: 0, failed: 1, remaining: 1 });
  });

  it.each([
    ["StorageApiError 404", { status: 404, name: "StorageApiError" }],
    ["StorageApiError 400", { status: 400, name: "StorageApiError" }],
    ["StorageUnknownError 404", { name: "StorageUnknownError", originalError: { status: 404 } }],
  ])("finishes an absent object reported as %s", async (_label, error) => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 1, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      exists: vi.fn().mockResolvedValue({ data: false, error }),
    });

    await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", expect.objectContaining({
      p_deleted_event_ids: [eventId],
      p_failed_event_ids: [],
    }));
  });

  it.each([
    ["status 500", { data: false, error: { status: 500, name: "StorageApiError" } }],
    ["status 403", { data: false, error: { status: 403, name: "StorageApiError" } }],
    ["object still present", { data: true, error: null }],
  ])("releases the claim when existence reconciliation reports %s", async (_label, existsResult) => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 0, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      exists: vi.fn().mockResolvedValue(existsResult),
    });

    await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", expect.objectContaining({
      p_deleted_event_ids: [],
      p_failed_event_ids: [eventId],
    }));
  });

  it("releases the claim when the existence check throws", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 0, out_released: 1 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      exists: vi.fn().mockRejectedValue(new Error("network_error")),
    });

    await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", expect.objectContaining({
      p_deleted_event_ids: [],
      p_failed_event_ids: [eventId],
    }));
  });

  it("finishes a reserved snapshot path that was never uploaded and clears remaining", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: [{ out_event_id: eventId, out_snapshot_path: path(), out_snapshot_captured_at: "2026-09-01T00:00:00Z" }], error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 1, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      exists: vi.fn().mockResolvedValue({ data: false, error: { status: 404, name: "StorageApiError" } }),
    });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc).toHaveBeenCalledWith("finish_snapshot_purge_batch", expect.objectContaining({
      p_deleted_event_ids: [eventId],
      p_failed_event_ids: [],
    }));
    expect(result).toMatchObject({ deleted: 1, failed: 0, remaining: 0 });
  });

  it("continues with another bounded batch when time remains", async () => {
    const rows = Array.from({ length: SNAPSHOT_PURGE_BATCH_SIZE + 1 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
      return { out_event_id: id, out_snapshot_path: path(id), out_snapshot_captured_at: "2026-09-01T00:00:00Z" };
    });
    const first = rows.slice(0, SNAPSHOT_PURGE_BATCH_SIZE);
    const second = rows.slice(SNAPSHOT_PURGE_BATCH_SIZE);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: rows.length, error: null })
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: first.length, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: second, error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: second.length, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    const remove = vi.fn()
      .mockResolvedValueOnce({ data: first.map((row) => ({ name: row.out_snapshot_path })), error: null })
      .mockResolvedValueOnce({ data: second.map((row) => ({ name: row.out_snapshot_path })), error: null });
    const client = clientWith(rpc, { remove, exists: vi.fn() });

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      now: () => 0,
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc.mock.calls.filter(([name]) => name === "claim_snapshot_purge_batch")).toHaveLength(2);
    expect(remove.mock.calls[0]![0]).toHaveLength(100);
    expect(remove.mock.calls[1]![0]).toHaveLength(1);
    expect(result).toMatchObject({ eligible: 101, deleted: 101, failed: 0, remaining: 0 });
  });

  it("claims at most 100 per batch and stops before another claim after the 20-second budget", async () => {
    const rows = Array.from({ length: SNAPSHOT_PURGE_BATCH_SIZE }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      return { out_event_id: id, out_snapshot_path: path(id), out_snapshot_captured_at: "2026-09-01T00:00:00Z" };
    });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 101, error: null })
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: [{ out_deleted: 100, out_released: 0 }], error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const client = clientWith(rpc, {
      remove: vi.fn().mockResolvedValue({ data: rows.map((row) => ({ name: row.out_snapshot_path })), error: null }),
      exists: vi.fn(),
    });
    const times = [0, 0, 20_001, 20_001];

    const result = await runSnapshotPurge({
      client,
      dryRun: false,
      retentionDays: "14",
      now: () => times.shift() ?? 20_001,
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(rpc).toHaveBeenCalledWith("claim_snapshot_purge_batch", expect.objectContaining({ p_batch_size: 100 }));
    expect(rpc.mock.calls.filter(([name]) => name === "claim_snapshot_purge_batch")).toHaveLength(1);
    expect(result).toMatchObject({ eligible: 101, deleted: 100, failed: 0, remaining: 1 });
  });
});
