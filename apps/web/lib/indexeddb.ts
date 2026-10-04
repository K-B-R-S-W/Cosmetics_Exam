"use client";

import type { DraftAnswer } from "@/components/exam/QuestionCard";

const DATABASE_NAME = "cosmetics-exam";
const DATABASE_VERSION = 1;
const STORE_NAME = "answerDrafts";
const ATTEMPT_INDEX = "attemptId";

export interface StoredAnswerDraft extends DraftAnswer {
  attempt_id: string;
  question_id: string;
  revision: number;
  confirmed_revision: number;
  dirty: boolean;
  saved_at: string | null;
  updated_at: number;
}

export interface AnswerDraftStore {
  readonly durable: boolean;
  loadAttempt(attemptId: string): Promise<StoredAnswerDraft[]>;
  put(draft: StoredAnswerDraft): Promise<void>;
  remove(attemptId: string, questionId: string): Promise<void>;
  clearAttempt(attemptId: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_request_failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb_transaction_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb_transaction_aborted"));
  });
}

export function createAnswerDraftStore(factory: IDBFactory | undefined = globalThis.indexedDB): AnswerDraftStore {
  const memory = new Map<string, StoredAnswerDraft>();
  let databasePromise: Promise<IDBDatabase> | null = null;
  let durable = Boolean(factory);
  const key = (attemptId: string, questionId: string) => `${attemptId}:${questionId}`;

  function database(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("indexeddb_unavailable"));
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          const store = db.objectStoreNames.contains(STORE_NAME)
            ? request.transaction!.objectStore(STORE_NAME)
            : db.createObjectStore(STORE_NAME, { keyPath: ["attempt_id", "question_id"] });
          if (!store.indexNames.contains(ATTEMPT_INDEX)) store.createIndex(ATTEMPT_INDEX, "attempt_id");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
        request.onblocked = () => reject(new Error("indexeddb_open_blocked"));
      }).catch((error) => {
        durable = false;
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise!;
  }

  async function withDatabase<T>(operation: (db: IDBDatabase) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    if (!durable) return fallback();
    try {
      return await operation(await database());
    } catch {
      durable = false;
      return fallback();
    }
  }

  return {
    get durable() { return durable; },
    async loadAttempt(attemptId) {
      return withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const rows = await requestResult(transaction.objectStore(STORE_NAME).index(ATTEMPT_INDEX).getAll(attemptId));
        for (const row of rows as StoredAnswerDraft[]) memory.set(key(row.attempt_id, row.question_id), row);
        return rows as StoredAnswerDraft[];
      }, () => [...memory.values()].filter((row) => row.attempt_id === attemptId));
    },
    async put(draft) {
      memory.set(key(draft.attempt_id, draft.question_id), structuredClone(draft));
      await withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(draft);
        await transactionDone(transaction);
      }, () => undefined);
    },
    async remove(attemptId, questionId) {
      memory.delete(key(attemptId, questionId));
      await withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete([attemptId, questionId]);
        await transactionDone(transaction);
      }, () => undefined);
    },
    async clearAttempt(attemptId) {
      for (const [entryKey, row] of memory) if (row.attempt_id === attemptId) memory.delete(entryKey);
      await withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const keys = await requestResult(store.index(ATTEMPT_INDEX).getAllKeys(attemptId));
        for (const entryKey of keys) store.delete(entryKey);
        await transactionDone(transaction);
      }, () => undefined);
    },
  };
}

let defaultStore: AnswerDraftStore | null = null;
export function getAnswerDraftStore(): AnswerDraftStore {
  defaultStore ??= createAnswerDraftStore();
  return defaultStore;
}
