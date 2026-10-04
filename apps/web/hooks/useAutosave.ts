"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DraftAnswer } from "@/components/exam/QuestionCard";
import type { AnswerInput, ApiErrorPayload, SavedAnswer, SaveAnswerResult } from "@/lib/candidate-types";
import { getAnswerDraftStore, type AnswerDraftStore, type StoredAnswerDraft } from "@/lib/indexeddb";

const DEBOUNCE_MS = 1_000;
const PERIODIC_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];

export type SaveIndicatorState =
  | { kind: "waiting"; durable: boolean; savedAt: string | null }
  | { kind: "saving"; durable: boolean; savedAt: string | null }
  | { kind: "saved"; durable: boolean; savedAt: string | null }
  | { kind: "offline"; durable: boolean; savedAt: string | null }
  | { kind: "retrying"; durable: boolean; savedAt: string | null }
  | { kind: "failed"; durable: boolean; savedAt: string | null };

interface UseAutosaveOptions {
  attemptId: string;
  questionIds: string[];
  serverAnswers: Record<string, SavedAnswer>;
  currentQuestionId: string | null;
  enabled?: boolean;
  store?: AnswerDraftStore;
  fetcher?: typeof fetch;
  onExamClosed?(): void;
  onSessionRevoked?(): void;
  onWrongPosition?(): void;
  onPermanentError?(code: string): void;
}

function valueFromSaved(answer: SavedAnswer | undefined): DraftAnswer {
  return {
    answer_text: answer?.answer_text ?? null,
    selected_option_id: answer?.selected_option_id ?? null,
    flagged: answer?.flagged ?? false,
  };
}

function storedFromServer(attemptId: string, questionId: string, answer: SavedAnswer | undefined): StoredAnswerDraft {
  return {
    attempt_id: attemptId,
    question_id: questionId,
    ...valueFromSaved(answer),
    revision: answer?.revision ?? 0,
    confirmed_revision: answer?.revision ?? 0,
    dirty: false,
    saved_at: answer?.saved_at ?? null,
    updated_at: Date.now(),
  };
}

export function mergeReconnectDraft(
  attemptId: string,
  questionId: string,
  server: SavedAnswer | undefined,
  local: StoredAnswerDraft | undefined,
): StoredAnswerDraft {
  const serverRevision = server?.revision ?? 0;
  if (local?.dirty && serverRevision === local.confirmed_revision) {
    return { ...local, revision: Math.max(local.revision, serverRevision) };
  }
  return storedFromServer(attemptId, questionId, server);
}

export function useAutosave({
  attemptId,
  questionIds,
  serverAnswers,
  currentQuestionId,
  enabled = true,
  store = getAnswerDraftStore(),
  fetcher = fetch,
  onExamClosed,
  onSessionRevoked,
  onWrongPosition,
  onPermanentError,
}: UseAutosaveOptions) {
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(questionIds.map((id) => [id, valueFromSaved(serverAnswers[id])])),
  );
  const [states, setStates] = useState<Record<string, SaveIndicatorState>>({});
  const [durable, setDurable] = useState(store.durable);
  const [ready, setReady] = useState(false);
  const records = useRef(new Map<string, StoredAnswerDraft>());
  const inFlight = useRef(new Map<string, Promise<void>>());
  const debounceTimers = useRef(new Map<string, number>());
  const retryTimers = useRef(new Map<string, number>());
  const retryCounts = useRef(new Map<string, number>());
  const staleRetries = useRef(new Map<string, number>());
  const blocked = useRef(new Set<string>());
  const mounted = useRef(true);
  const initializedAttempt = useRef<string | null>(null);

  const setQuestionState = useCallback((questionId: string, kind: SaveIndicatorState["kind"], savedAt?: string | null) => {
    if (!mounted.current) return;
    setStates((current) => ({
      ...current,
      [questionId]: { kind, durable: store.durable, savedAt: savedAt === undefined ? current[questionId]?.savedAt ?? null : savedAt },
    }));
    setDurable(store.durable);
  }, [store]);

  const persist = useCallback(async (record: StoredAnswerDraft) => {
    records.current.set(record.question_id, record);
    await store.put(record);
    if (mounted.current) setDurable(store.durable);
  }, [store]);

  const scheduleRetryRef = useRef<(questionId: string) => void>(() => undefined);
  const sendRef = useRef<(questionId: string) => Promise<void>>(async () => undefined);

  const send = useCallback(async (questionId: string): Promise<void> => {
    if (!enabled) return;
    if (blocked.current.has(questionId)) return;
    const existing = inFlight.current.get(questionId);
    if (existing) return existing;
    const record = records.current.get(questionId);
    if (!record?.dirty) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setQuestionState(questionId, "offline");
      scheduleRetryRef.current(questionId);
      return;
    }

    const operation = (async () => {
      const latest = records.current.get(questionId);
      if (!latest?.dirty) return;
      const sentRevision = Math.max(latest.revision, latest.confirmed_revision) + 1;
      const snapshot = { ...latest, revision: sentRevision };
      await persist(snapshot);
      setQuestionState(questionId, "saving");
      try {
        const response = await fetcher("/api/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_id: questionId,
            answer_text: snapshot.answer_text,
            selected_option_id: snapshot.selected_option_id,
            flagged: snapshot.flagged,
            revision: sentRevision,
          }),
        });
        const body = await response.json().catch(() => null) as SaveAnswerResult | ApiErrorPayload | null;
        if (response.ok && body && "result" in body) {
          const current = records.current.get(questionId);
          if (!current) return;
          if (body.result === "stale_revision") {
            const staleCount = staleRetries.current.get(questionId) ?? 0;
            const recovered = { ...current, revision: body.server_revision, dirty: true };
            await persist(recovered);
            setQuestionState(questionId, "waiting");
            if (staleCount >= 1) {
              blocked.current.add(questionId);
              setQuestionState(questionId, "failed");
              onPermanentError?.("stale_revision");
              return;
            }
            staleRetries.current.set(questionId, staleCount + 1);
          } else {
            const unchanged = current.updated_at === snapshot.updated_at;
            const confirmed = {
              ...current,
              revision: Math.max(current.revision, sentRevision),
              confirmed_revision: sentRevision,
              dirty: !unchanged,
              saved_at: body.server_time,
            };
            await persist(confirmed);
            retryCounts.current.delete(questionId);
            staleRetries.current.delete(questionId);
            setQuestionState(questionId, unchanged ? "saved" : "waiting", body.server_time);
          }
          return;
        }
        const code = body && "error" in body ? body.error.code : "internal_error";
        if (response.status >= 500) {
          setQuestionState(questionId, "retrying");
          scheduleRetryRef.current(questionId);
          return;
        }
        if (code === "exam_closed") {
          blocked.current.add(questionId);
          onExamClosed?.();
          setQuestionState(questionId, "failed");
          return;
        }
        if (code === "session_revoked" || code === "unauthenticated") onSessionRevoked?.();
        const current = records.current.get(questionId);
        const discard = code === "wrong_position" || code === "not_in_paper" || code === "bad_option";
        if (current && discard) await persist({ ...current, dirty: false });
        blocked.current.add(questionId);
        if (code === "wrong_position") {
          setQuestionState(questionId, "waiting");
          onWrongPosition?.();
        } else {
          setQuestionState(questionId, "failed");
        }
        onPermanentError?.(code);
      } catch (error) {
        setQuestionState(questionId, error instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine) ? "offline" : "retrying");
        scheduleRetryRef.current(questionId);
      }
    })().finally(() => {
      inFlight.current.delete(questionId);
      const current = records.current.get(questionId);
      if (current?.dirty && !blocked.current.has(questionId) && !retryTimers.current.has(questionId)) queueMicrotask(() => void sendRef.current(questionId));
    });
    inFlight.current.set(questionId, operation);
    return operation;
  }, [enabled, fetcher, onExamClosed, onPermanentError, onSessionRevoked, onWrongPosition, persist, setQuestionState]);
  useEffect(() => { sendRef.current = send; }, [send]);

  const scheduleRetry = useCallback((questionId: string) => {
    if (retryTimers.current.has(questionId)) return;
    const count = retryCounts.current.get(questionId) ?? 0;
    const delay = RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length - 1)]!;
    retryCounts.current.set(questionId, count + 1);
    const timer = window.setTimeout(() => {
      retryTimers.current.delete(questionId);
      void sendRef.current(questionId);
    }, delay);
    retryTimers.current.set(questionId, timer);
  }, []);
  useEffect(() => { scheduleRetryRef.current = scheduleRetry; }, [scheduleRetry]);

  useEffect(() => {
    mounted.current = true;
    if (initializedAttempt.current === attemptId) return;
    setReady(false);
    let active = true;
    void store.loadAttempt(attemptId).then(async (localRows) => {
      if (!active) return;
      const local = new Map(localRows.map((row) => [row.question_id, row]));
      const merged = questionIds.map((questionId) => mergeReconnectDraft(attemptId, questionId, serverAnswers[questionId], local.get(questionId)));
      records.current = new Map(merged.map((row) => [row.question_id, row]));
      await Promise.all(merged.map((row) => store.put(row)));
      if (!active) return;
      initializedAttempt.current = attemptId;
      setAnswers(Object.fromEntries(merged.map((row) => [row.question_id, { answer_text: row.answer_text, selected_option_id: row.selected_option_id, flagged: row.flagged }])));
      setStates(Object.fromEntries(merged.map((row) => [row.question_id, { kind: row.dirty ? "waiting" : "saved", durable: store.durable, savedAt: row.saved_at } satisfies SaveIndicatorState])));
      setDurable(store.durable);
      setReady(true);
      for (const row of merged) if (row.dirty) void sendRef.current(row.question_id);
    });
    return () => { active = false; };
  }, [attemptId, questionIds, serverAnswers, store]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const record of records.current.values()) if (record.dirty) void sendRef.current(record.question_id);
    }, PERIODIC_MS);
    const online = () => {
      retryCounts.current.clear();
      for (const timer of retryTimers.current.values()) window.clearTimeout(timer);
      retryTimers.current.clear();
      for (const record of records.current.values()) if (record.dirty) void sendRef.current(record.question_id);
    };
    window.addEventListener("online", online);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    for (const timer of debounceTimers.current.values()) window.clearTimeout(timer);
    for (const timer of retryTimers.current.values()) window.clearTimeout(timer);
  }, []);

  const updateAnswer = useCallback((questionId: string, value: DraftAnswer, immediate = false) => {
    blocked.current.delete(questionId);
    staleRetries.current.delete(questionId);
    const current = records.current.get(questionId) ?? storedFromServer(attemptId, questionId, serverAnswers[questionId]);
    const next = { ...current, ...value, dirty: true, updated_at: Math.max(Date.now(), current.updated_at + 1) };
    setAnswers((existing) => ({ ...existing, [questionId]: value }));
    setQuestionState(questionId, "waiting");
    void persist(next).then(() => {
      const oldTimer = debounceTimers.current.get(questionId);
      if (oldTimer !== undefined) window.clearTimeout(oldTimer);
      if (immediate) void sendRef.current(questionId);
      else debounceTimers.current.set(questionId, window.setTimeout(() => {
        debounceTimers.current.delete(questionId);
        void sendRef.current(questionId);
      }, DEBOUNCE_MS));
    });
  }, [attemptId, persist, serverAnswers, setQuestionState]);

  const flushQuestion = useCallback(async (questionId: string) => {
    const timer = debounceTimers.current.get(questionId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      debounceTimers.current.delete(questionId);
    }
    await sendRef.current(questionId);
    await inFlight.current.get(questionId);
    if (records.current.get(questionId)?.dirty && !retryTimers.current.has(questionId)) await sendRef.current(questionId);
  }, []);

  const pendingAnswers = useCallback((): AnswerInput[] => [...records.current.values()]
    .filter((record) => record.dirty)
    .map((record) => ({
      question_id: record.question_id,
      answer_text: record.answer_text,
      selected_option_id: record.selected_option_id,
      flagged: record.flagged,
      revision: Math.max(record.revision, record.confirmed_revision) + 1,
    })), []);

  const flushAll = useCallback(async (timeoutMs = 3_000): Promise<AnswerInput[]> => {
    const flushing = Promise.all([...records.current.keys()].map((questionId) => flushQuestion(questionId)));
    await Promise.race([flushing, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
    return pendingAnswers();
  }, [flushQuestion, pendingAnswers]);

  const currentState = useMemo<SaveIndicatorState>(() => {
    if (!currentQuestionId) return { kind: "saved", durable, savedAt: null };
    return states[currentQuestionId] ?? { kind: "saved", durable, savedAt: serverAnswers[currentQuestionId]?.saved_at ?? null };
  }, [currentQuestionId, durable, serverAnswers, states]);

  return { answers, updateAnswer, flushQuestion, flushAll, pendingAnswers, currentState, durable, ready };
}
