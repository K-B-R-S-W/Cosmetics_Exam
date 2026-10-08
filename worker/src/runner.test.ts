import { expect, it, vi } from "vitest";
import type { GradingRepository } from "./grader";
import { runGradingTick } from "./runner";
import { SlotManager } from "./slots";
import { DEFAULT_GRADING_TUNING } from "./config";

function repository(): GradingRepository {
  return {
    resetStuck: vi.fn().mockResolvedValue(0), pendingJobs: vi.fn().mockResolvedValue([]), claim: vi.fn(), loadItems: vi.fn(), saveScores: vi.fn(), complete: vi.fn(), fail: vi.fn(), failPermanently: vi.fn(), requeue: vi.fn(), split: vi.fn(), recompute: vi.fn(), log: vi.fn(), pauseRun: vi.fn().mockResolvedValue(true), pauseAll: vi.fn().mockResolvedValue(0), updateKey: vi.fn(), alert: vi.fn(), resumeDue: vi.fn().mockResolvedValue(0), finishRuns: vi.fn().mockResolvedValue(0), usageSince: vi.fn().mockResolvedValue({}), hasWork: vi.fn().mockResolvedValue(false), queueCounts: vi.fn().mockResolvedValue({ pending: 0, running: 0, failed: 0 }),
  };
}

it("discovers up to three jobs without sharing another lane", async () => {
  const repo = repository();
  await expect(runGradingTick({ repository: repo, config: { ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash", keys: [], reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1_000 }, slots: new SlotManager([], 0, 0) })).resolves.toEqual({ active: false, processed: 0 });
  expect(repo.pendingJobs).toHaveBeenCalledWith(3);
});

it("does not split or complete a job when a score write fails", async () => {
  const repo = repository();
  vi.mocked(repo.pendingJobs).mockResolvedValue([{ id: "job", runId: "run", attemptId: "attempt", chunkIndex: 0, questionIds: ["question"], tries: 0 }]);
  vi.mocked(repo.claim).mockResolvedValue(true);
  vi.mocked(repo.loadItems).mockResolvedValue([{ questionId: "question", questionHtml: "Q", answerText: "A", modelAnswer: "A", maxMarks: 1 }]);
  vi.mocked(repo.saveScores).mockRejectedValue(new Error("database_error"));
  const response = [{ item: "1", candidate_meaning_english: "A", matched_points: ["A"], missing_points: [], incorrect_claims: [], marks: 1, verdict: "correct", reason: "Correct.", confidence: 1, language: "english" }];
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }), { status: 200 }));
  const keys = [{ label: "key1", key: "secret", dailyLimit: 10 }];
  await runGradingTick({ repository: repo, config: { ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash", keys, reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1_000 }, slots: new SlotManager(keys, 0, 0), fetcher });
  expect(repo.split).not.toHaveBeenCalled();
  expect(repo.complete).not.toHaveBeenCalled();
});

it("holds transient retries for the 2 second first backoff", async () => {
  const repo = repository(); const job = { id: "job", runId: "run", attemptId: "attempt", chunkIndex: 0, questionIds: ["question"], tries: 0 };
  vi.mocked(repo.pendingJobs).mockResolvedValue([job]); vi.mocked(repo.claim).mockResolvedValue(true);
  vi.mocked(repo.loadItems).mockResolvedValue([{ questionId: "question", questionHtml: "Q", answerText: "A", modelAnswer: "A", maxMarks: 1 }]);
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 500 })); const retryState = new Map(); let now = 0;
  const keys = [{ label: "key1", key: "secret", dailyLimit: 10 }]; const slots = new SlotManager(keys, 0, 0);
  const deps = { repository: repo, config: { ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash" as const, keys, reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1_000 }, slots, fetcher, retryState, now: () => new Date(now) };
  await runGradingTick(deps); now = 1_000; await runGradingTick(deps); expect(fetcher).toHaveBeenCalledOnce();
  now = 2_000; await runGradingTick(deps); expect(fetcher).toHaveBeenCalledTimes(2);
});
