// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createAnswerDraftStore, type StoredAnswerDraft } from "./indexeddb";

function draft(attempt = "attempt-a", question = "question-a"): StoredAnswerDraft {
  return { attempt_id: attempt, question_id: question, answer_text: "Synthetic", selected_option_id: null, flagged: false, revision: 2, confirmed_revision: 1, dirty: true, saved_at: null, updated_at: 1 };
}

describe("answer draft IndexedDB store", () => {
  it("persists drafts, isolates attempts, removes rows, and clears one attempt", async () => {
    const factory = new IDBFactory();
    const store = createAnswerDraftStore(factory);
    await store.put(draft());
    await store.put(draft("attempt-b", "question-b"));
    expect(store.durable).toBe(true);
    expect(await store.loadAttempt("attempt-a")).toEqual([draft()]);
    await store.remove("attempt-a", "question-a");
    expect(await store.loadAttempt("attempt-a")).toEqual([]);
    await store.clearAttempt("attempt-b");
    expect(await store.loadAttempt("attempt-b")).toEqual([]);
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    const store = createAnswerDraftStore(undefined);
    await expect(store.put(draft())).resolves.toBeUndefined();
    expect(store.durable).toBe(false);
    expect(await store.loadAttempt("attempt-a")).toEqual([draft()]);
  });

  it("falls back without losing the current write when opening throws", async () => {
    const broken = { open: () => { throw new Error("private mode"); } } as unknown as IDBFactory;
    const store = createAnswerDraftStore(broken);
    await store.put(draft());
    expect(store.durable).toBe(false);
    expect(await store.loadAttempt("attempt-a")).toEqual([draft()]);
  });
});
