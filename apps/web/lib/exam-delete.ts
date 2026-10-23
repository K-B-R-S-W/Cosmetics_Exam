import type { SupabaseClient } from "@supabase/supabase-js";

import { databaseUnavailable } from "@/lib/admin-server";

const PAGE_SIZE = 1_000;
const STORAGE_BATCH_SIZE = 100;

export interface ExamDeleteCounts {
  questions: number;
  assigned_candidates: number;
  attempts: number;
  results: number;
}

export interface ExamStoragePaths {
  questionImages: string[];
  snapshots: string[];
}

type CountResult = { count: number | null; error: unknown };
type RowsResult<T> = { data: T[] | null; error: unknown };

function requireCount(result: CountResult): number {
  if (result.error || result.count === null) throw databaseUnavailable();
  return result.count;
}

export async function loadExamDeleteCounts(client: SupabaseClient, examId: string): Promise<ExamDeleteCounts> {
  const [questions, candidates, attempts, results] = await Promise.all([
    client.from("questions").select("id", { count: "exact", head: true }).eq("exam_id", examId),
    client.from("exam_candidates").select("candidate_id", { count: "exact", head: true }).eq("exam_id", examId),
    client.from("attempts").select("id", { count: "exact", head: true }).eq("exam_id", examId),
    client.from("results").select("attempt_id, attempts!inner(exam_id)", { count: "exact", head: true }).eq("attempts.exam_id", examId),
  ]);
  return {
    questions: requireCount(questions),
    assigned_candidates: requireCount(candidates),
    attempts: requireCount(attempts),
    results: requireCount(results),
  };
}

async function loadAllRows<T>(page: (from: number, to: number) => PromiseLike<RowsResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) throw databaseUnavailable();
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

export async function loadExamStoragePaths(client: SupabaseClient, examId: string): Promise<ExamStoragePaths> {
  const [questionRows, snapshotRows] = await Promise.all([
    loadAllRows<{ image_path: string }>((from, to) => client
      .from("questions").select("image_path").eq("exam_id", examId)
      .not("image_path", "is", null).range(from, to)),
    loadAllRows<{ snapshot_path: string }>((from, to) => client
      .from("violation_events").select("snapshot_path, attempts!inner(exam_id)")
      .eq("attempts.exam_id", examId).not("snapshot_path", "is", null).range(from, to)),
  ]);
  return {
    questionImages: [...new Set(questionRows.map((row) => row.image_path))],
    snapshots: [...new Set(snapshotRows.map((row) => row.snapshot_path))],
  };
}

async function removePaths(client: SupabaseClient, bucket: string, paths: string[]): Promise<number> {
  let failed = 0;
  const storage = client.storage.from(bucket);
  for (let index = 0; index < paths.length; index += STORAGE_BATCH_SIZE) {
    const batch = paths.slice(index, index + STORAGE_BATCH_SIZE);
    try {
      const result = await storage.remove(batch);
      if (result.error) {
        const checks = await Promise.all(batch.map(async (path) => {
          try {
            const exists = await storage.exists(path);
            const status = Number((exists.error as { status?: unknown } | null)?.status);
            const code = String((exists.error as { code?: unknown } | null)?.code ?? "").toLowerCase();
            return exists.data !== false || Boolean(exists.error && status !== 400 && status !== 404 && !["nosuchkey", "objectnotfound", "object_not_found"].includes(code));
          } catch {
            return true;
          }
        }));
        failed += checks.filter(Boolean).length;
      }
    } catch {
      failed += batch.length;
    }
  }
  return failed;
}

export async function removeExamStorage(client: SupabaseClient, paths: ExamStoragePaths): Promise<number> {
  const [questionFailures, snapshotFailures] = await Promise.all([
    removePaths(client, "question-images", paths.questionImages),
    removePaths(client, "snapshots", paths.snapshots),
  ]);
  return questionFailures + snapshotFailures;
}
