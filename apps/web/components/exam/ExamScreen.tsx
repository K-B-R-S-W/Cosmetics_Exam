"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CandidateErrorScreen, CandidatePaperError, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { QuestionCard, type DraftAnswer } from "@/components/exam/QuestionCard";
import { QuestionList, answerStatus } from "@/components/exam/QuestionList";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
import { Timer } from "@/components/exam/Timer";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { useExamStatePoll } from "@/hooks/useExamStatePoll";
import type { ApiErrorPayload, NextQuestionBody, PaperBody } from "@/lib/candidate-types";
import { langFor } from "@/lib/lang";
import { PAPER_RETRY_DELAY_MS, PAPER_RETRY_NOTICE, usePaperRetryTracker } from "@/lib/paper-retry";
import { refineServerClock } from "@/lib/time";

const GRACE_MS = 15_000;
const NEXT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;

type NextBody = NextQuestionBody | { result: "last_question"; position: number; server_time: string };

function isBlank(question: PaperBody["questions"][number], answer: DraftAnswer | undefined): boolean {
  return question.type === "mcq"
    ? !answer?.selected_option_id
    : !(answer?.answer_text ?? "").trim();
}

function apiCode(body: unknown): string {
  return body && typeof body === "object" && "error" in body
    ? ((body as ApiErrorPayload).error.code)
    : "internal_error";
}

function ExamDialog({
  title,
  body,
  confirm,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCloseRef.current();
      if (event.key === "Tab" && dialogRef.current) {
        const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
        if (controls.length === 0) return;
        const first = controls[0]!;
        const last = controls.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      previousFocus?.focus();
    };
  }, [busy]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[rgb(17_24_39/0.45)] p-6"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="exam-dialog-title" tabIndex={-1} className="w-full max-w-md rounded-control bg-surface p-6 shadow-xl"><h2 id="exam-dialog-title" className="text-title font-bold">{title}</h2><p className="mt-3 text-muted">{body}</p>{error ? <p role="alert" className="mt-4 text-warn">{error}</p> : null}<div className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="secondary" disabled={busy} onClick={onClose}>Keep working</Button><Button loading={busy} onClick={onConfirm}>{confirm}</Button></div></div></div>;
}

export function isTransientPaperFailure(error: unknown): boolean {
  return !(error instanceof CandidatePaperError) || error.status >= 500 || error.code === "service_unavailable";
}

export function ExamScreen() {
  const router = useRouter();
  const { state, me, paper, loadMe, loadPaper, refreshState } = useCandidate();
  const [loadedPaper, setLoadedPaper] = useState<PaperBody | null>(paper);
  const [activeIndex, setActiveIndex] = useState(0);
  const [summary, setSummary] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(!paper);
  const [transientError, setTransientError] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [retryCycle, setRetryCycle] = useState(0);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [expiredDeadline, setExpiredDeadline] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"blank" | "submit" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [nextRetrying, setNextRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [terminalNotice, setTerminalNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryVisibleTimer = useRef<number | null>(null);
  const actionLock = useRef(false);
  const autoSubmitStarted = useRef(false);
  const lockStartedAt = useRef<number | null>(null);
  const nextRetry = useRef<number | null>(null);
  const nextRetryCount = useRef(0);
  const submitRetry = useRef<number | null>(null);
  const submitAttemptRef = useRef<(reason: "manual" | "auto") => Promise<void>>(async () => undefined);
  const advanceRef = useRef<(allowBlank?: boolean) => Promise<void>>(async () => undefined);
  const { recordFailure, resetFailures, showTakingLonger } = usePaperRetryTracker();

  const questions = useMemo(() => loadedPaper?.questions ?? [], [loadedPaper]);
  const visibleQuestion = loadedPaper?.navigation_mode === "sequential" ? questions[0] : questions[activeIndex];
  const locallyExpired = expiredDeadline !== null && expiredDeadline === (state?.attempt.deadline ?? "closed");
  const locked = locallyExpired || state?.phase === "closed";
  const serverAnswers = useMemo(() => loadedPaper?.answers ?? {}, [loadedPaper]);
  const questionIds = useMemo(() => questions.map((question) => question.id), [questions]);

  const resyncSequential = useCallback(async () => {
    await refreshState().catch(() => null);
    const current = await loadPaper(true).catch(() => null);
    if (current) {
      setLoadedPaper(current);
      setSummary(false);
    }
  }, [loadPaper, refreshState]);

  const autosave = useAutosave({
    attemptId: state?.attempt.id ?? "pending",
    questionIds,
    serverAnswers,
    currentQuestionId: visibleQuestion?.id ?? null,
    enabled: Boolean(loadedPaper) && !locked,
    onExamClosed: () => setExpiredDeadline(state?.attempt.deadline ?? "closed"),
    onSessionRevoked: () => void refreshState().catch(() => null),
    onWrongPosition: () => void resyncSequential(),
  });
  useExamStatePoll(refreshState, true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setFatalError(null);
    try {
      const next = await loadPaper(force);
      refineServerClock(next.server_time);
      setTransientError(false);
      resetFailures();
      setShowRetry(false);
      if (retryVisibleTimer.current !== null) {
        window.clearTimeout(retryVisibleTimer.current);
        retryVisibleTimer.current = null;
      }
      setLoadedPaper(next);
      await refreshState().catch(() => null);
    } catch (error) {
      if (isTransientPaperFailure(error)) {
        recordFailure();
        setTransientError(true);
        setRetryCycle((value) => value + 1);
        if (retryVisibleTimer.current === null) retryVisibleTimer.current = window.setTimeout(() => setShowRetry(true), 8000);
      } else if (error instanceof CandidatePaperError) {
        const next = await refreshState().catch(() => null);
        if (error.code === "not_acknowledged") router.push("/rules");
        else if (error.code === "attempt_closed") router.push("/done");
        else if (error.code === "exam_not_live") router.push("/waiting");
        else if (error.code === "exam_closed" && next?.attempt.status === "in_progress") setExpiredDeadline(next.attempt.deadline ?? "closed");
        else setFatalError(error.code);
      }
    } finally {
      setLoading(false);
    }
  }, [loadPaper, recordFailure, refreshState, resetFailures, router]);

  useEffect(() => { if (!me) void loadMe().catch(() => null); }, [loadMe, me]);
  useEffect(() => {
    if (loadedPaper) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, loadedPaper]);
  useEffect(() => {
    if (!transientError) return;
    const retry = window.setTimeout(() => void load(true), PAPER_RETRY_DELAY_MS);
    return () => window.clearTimeout(retry);
  }, [load, retryCycle, transientError]);
  useEffect(() => () => {
    if (retryVisibleTimer.current !== null) window.clearTimeout(retryVisibleTimer.current);
    if (nextRetry.current !== null) window.clearTimeout(nextRetry.current);
    if (submitRetry.current !== null) window.clearTimeout(submitRetry.current);
  }, []);
  useEffect(() => {
    const keepHere = () => window.history.pushState(null, "", window.location.href);
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", keepHere);
    return () => window.removeEventListener("popstate", keepHere);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.pendingAnswers().length > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave]);
  useEffect(() => { if (!summary) headingRef.current?.focus(); }, [activeIndex, summary, visibleQuestion?.id]);
  useEffect(() => {
    if (locked) return;
    autoSubmitStarted.current = false;
    lockStartedAt.current = null;
  }, [locked]);
  useEffect(() => {
    const title = locked
      ? "Time is up"
      : summary
        ? "Review"
        : visibleQuestion
          ? `Question ${visibleQuestion.position + 1}`
          : "Online exam";
    document.title = `${title} · ${state?.exam.title ?? "Cosmetics.lk"}`;
  }, [locked, state?.exam.title, summary, visibleQuestion]);

  const submitAttempt = useCallback(async (reason: "manual" | "auto") => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      const pending = await autosave.flushAll(3_000);
      const response = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, pending_answers: pending }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        await autosave.clearDrafts();
        await refreshState().catch(() => null);
        router.push("/done");
        return;
      }
      const code = apiCode(body);
      if (code === "collection_closed") {
        setTerminalNotice(autosave.pendingAnswers().length > 0
          ? "Time is up. Some answers could not be sent. Keep this page open and tell the exam team."
          : "Time is up. Keep this page open and tell the exam team.");
        return;
      }
      if (code === "session_revoked" || code === "unauthenticated") await refreshState().catch(() => null);
      throw new Error(code);
    } catch {
      if (reason === "manual") {
        setActionError(autosave.durable
          ? "We couldn't submit yet. Your answers are saved. Try again."
          : "We couldn't submit yet. Keep this window open and try again.");
      } else {
        const deadline = state?.exam.force_ended || !state?.attempt.deadline
          ? (lockStartedAt.current ?? Date.now()) + GRACE_MS
          : new Date(state.attempt.deadline).getTime() + GRACE_MS;
        if (Date.now() >= deadline) {
          setTerminalNotice(autosave.pendingAnswers().length > 0
            ? "Time is up. Some answers could not be sent. Keep this page open and tell the exam team."
            : "Time is up. Keep this page open and tell the exam team.");
        }
        else submitRetry.current = window.setTimeout(() => { actionLock.current = false; void submitAttemptRef.current("auto"); }, 1_000);
      }
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }, [autosave, refreshState, router, state]);
  useEffect(() => { submitAttemptRef.current = submitAttempt; }, [submitAttempt]);

  useEffect(() => {
    if (!locked || state?.attempt.status !== "in_progress" || autoSubmitStarted.current) return;
    autoSubmitStarted.current = true;
    lockStartedAt.current = Date.now();
    void submitAttempt("auto");
  }, [locked, state?.attempt.status, submitAttempt]);

  const moveFree = useCallback(async (position: number) => {
    if (!visibleQuestion) return;
    await Promise.race([autosave.flushQuestion(visibleQuestion.id), new Promise<void>((resolve) => window.setTimeout(resolve, 1_000))]);
    setActiveIndex(position);
  }, [autosave, visibleQuestion]);

  const advance = useCallback(async (allowBlank = false) => {
    if (!visibleQuestion || !loadedPaper || actionLock.current) return;
    const answer = autosave.answers[visibleQuestion.id];
    if (isBlank(visibleQuestion, answer) && !allowBlank) {
      setDialog("blank");
      return;
    }
    if (isBlank(visibleQuestion, answer)) {
      await autosave.flushQuestion(visibleQuestion.id);
      if (autosave.pendingAnswers().some((item) => item.question_id === visibleQuestion.id)) {
        setActionError("Could not save this answer. Tell the exam team.");
        return;
      }
    }
    const input = autosave.answerInput(visibleQuestion.id);
    if (!input) return;
    actionLock.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/exam/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, expected_position: visibleQuestion.position }),
      });
      const body = await response.json().catch(() => null) as NextBody | ApiErrorPayload | null;
      if (!response.ok) {
        const code = apiCode(body);
        if (code === "exam_closed") setExpiredDeadline(state?.attempt.deadline ?? "closed");
        else if (code === "invalid_state" || code === "wrong_position") await resyncSequential();
        else if (response.status >= 500) throw new TypeError(code);
        else {
          if (code === "session_revoked" || code === "unauthenticated") await refreshState().catch(() => null);
          setActionError("Could not move to the next question. Tell the exam team.");
        }
        return;
      }
      const next = body as NextBody;
      nextRetryCount.current = 0;
      await autosave.confirmDirectSave(visibleQuestion.id, input.revision, next.server_time);
      if (next.result === "last_question") {
        setDialog("submit");
      } else {
        setLoadedPaper({
          ...loadedPaper,
          current_position: next.position,
          questions: [next.question],
          answers: next.answer ? { [next.question.id]: next.answer } : {},
          server_time: next.server_time,
        });
        if (next.result === "out_of_sync") setMoveNotice(`We moved you to question ${next.position + 1}.`);
        setNextRetrying(false);
        await refreshState().catch(() => null);
      }
    } catch {
      setActionError("Reconnecting…");
      setNextRetrying(true);
      const delay = NEXT_RETRY_DELAYS_MS[Math.min(nextRetryCount.current, NEXT_RETRY_DELAYS_MS.length - 1)]!;
      nextRetryCount.current += 1;
      nextRetry.current = window.setTimeout(() => {
        nextRetry.current = null;
        actionLock.current = false;
        setNextRetrying(false);
        void advanceRef.current(true);
      }, delay);
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }, [autosave, loadedPaper, refreshState, resyncSequential, state, visibleQuestion]);
  useEffect(() => { advanceRef.current = advance; }, [advance]);

  const answeredCount = useMemo(() => questions.filter((question) => answerStatus(question, autosave.answers[question.id]).startsWith("Answered")).length, [autosave.answers, questions]);
  const flaggedCount = useMemo(() => questions.filter((question) => autosave.answers[question.id]?.flagged).length, [autosave.answers, questions]);
  const unansweredCount = questions.length - answeredCount;

  if (!state) return <main className="exam-shell"><p className="m-auto text-muted">Loading…</p></main>;
  if (fatalError === "exam_has_no_questions") return <CandidateErrorScreen title="This exam has no questions yet." body="Tell the exam team." signOut />;
  if (fatalError === "exam_closed" && state.attempt.status === "acknowledged") return <CandidateErrorScreen title="This exam has ended." body="The exam is closed." signOut />;
  if (transientError) return <main className="exam-shell"><section className="m-auto max-w-md p-6"><h1 tabIndex={-1} className="text-title font-bold">Loading your exam…</h1><p className="mt-4 text-muted">We couldn&apos;t load the exam yet.</p>{showTakingLonger ? <p className="mt-3 text-warn" role="status">{PAPER_RETRY_NOTICE}</p> : null}{showRetry ? <Button className="mt-6" onClick={() => void load(true)}>Retry</Button> : null}</section></main>;

  return (
    <main className="exam-shell bg-paper">
      <header className="exam-strip flex min-h-14 items-center justify-between gap-4 border-b border-hairline bg-surface px-5 py-2">
        <div className="exam-strip-title min-w-0"><p className="truncate font-bold" lang={langFor(state.exam.title)}>{state.exam.title}</p>{me ? <p className="truncate text-xs text-muted">{me.candidate.full_name} · {me.candidate.mer_code}</p> : null}</div>
        <p aria-live="off" className="shrink-0 text-sm">{loadedPaper?.navigation_mode === "sequential" && visibleQuestion ? `Question ${visibleQuestion.position + 1} of ${loadedPaper.total_questions}` : `${loadedPaper?.total_questions ?? state.exam.question_count} questions · ${answeredCount} answered`}</p>
        <div className="flex shrink-0 items-center gap-4"><SaveIndicator state={autosave.currentState} /><Timer deadline={state.attempt.deadline} onExpired={() => { setTerminalNotice(null); setExpiredDeadline(state.attempt.deadline ?? "closed"); }} /></div>
      </header>
      {moveNotice ? <Notice>{moveNotice}</Notice> : null}
      {actionError && !dialog ? <Notice warning>{actionError}</Notice> : null}
      {locked ? (
        <section className="m-auto max-w-md p-6 text-center"><h1 tabIndex={-1} className="text-title font-bold">{state.exam.force_ended ? "The exam has ended" : "Time is up"}</h1><p className="mt-4 text-muted">{terminalNotice ?? (actionError || "Keep this page open while your answers are submitted.")}</p></section>
      ) : loading || !loadedPaper || !visibleQuestion ? (
        <section className="m-auto p-6"><h1 tabIndex={-1} className="text-title font-bold">Loading your exam…</h1></section>
      ) : summary ? (
        <section className="exam-scroll-region mx-auto w-full max-w-[68ch] p-6"><h1 tabIndex={-1} className="text-title font-bold">Review your answers</h1><p className="mt-4 text-muted">{answeredCount} answered · {unansweredCount} not answered · {flaggedCount} flagged</p><ul className="mt-6 space-y-2">{questions.filter((question) => answerStatus(question, autosave.answers[question.id]) !== "Answered" || autosave.answers[question.id]?.flagged).map((question) => <li key={question.id}><Button variant="quiet" onClick={() => { setActiveIndex(question.position); setSummary(false); }}>Question {question.position + 1}: {answerStatus(question, autosave.answers[question.id])}</Button></li>)}</ul>{unansweredCount === 0 && flaggedCount === 0 ? <p className="mt-6">All {questions.length} questions are answered.</p> : null}<div className="mt-8 flex justify-between gap-4"><Button variant="secondary" onClick={() => setSummary(false)}>Back to questions</Button><Button onClick={() => setDialog("submit")}>Submit exam</Button></div></section>
      ) : (
        <div className="exam-content flex min-h-0">
          {loadedPaper.navigation_mode === "free" ? <QuestionList questions={questions} answers={autosave.answers} activeIndex={activeIndex} onSelect={(position) => void moveFree(position)} drawerOpen={drawerOpen} onDrawerOpen={setDrawerOpen} /> : null}
          <section className="exam-scroll-region flex-1 p-6">
            <QuestionCard key={visibleQuestion.id} question={visibleQuestion} answer={autosave.answers[visibleQuestion.id] ?? { answer_text: null, selected_option_id: null, flagged: false }} disabled={!autosave.ready || actionBusy} headingRef={headingRef} onChange={(answer) => autosave.updateAnswer(visibleQuestion.id, answer, visibleQuestion.type === "mcq")} />
            {loadedPaper.navigation_mode === "free" ? <div className="mx-auto mt-5 flex max-w-[68ch] justify-end"><Button variant="secondary" disabled={!autosave.ready || actionBusy} aria-pressed={autosave.answers[visibleQuestion.id]?.flagged ?? false} onClick={() => autosave.updateAnswer(visibleQuestion.id, { ...(autosave.answers[visibleQuestion.id] ?? { answer_text: null, selected_option_id: null, flagged: false }), flagged: !(autosave.answers[visibleQuestion.id]?.flagged ?? false) }, true)}>{autosave.answers[visibleQuestion.id]?.flagged ? "Remove flag" : "Flag for review"}</Button></div> : null}
          </section>
        </div>
      )}
      {!locked && loadedPaper && visibleQuestion && !summary ? <footer className="exam-bottom-bar flex min-h-16 items-center justify-end gap-3 border-t border-hairline bg-surface px-5 py-2">{loadedPaper.navigation_mode === "free" ? <><Button variant="secondary" disabled={!autosave.ready || actionBusy || activeIndex === 0} onClick={() => void moveFree(Math.max(0, activeIndex - 1))}>Previous</Button>{activeIndex === questions.length - 1 ? <Button disabled={!autosave.ready || actionBusy} onClick={() => setSummary(true)}>Review and submit</Button> : <Button disabled={!autosave.ready || actionBusy} onClick={() => void moveFree(Math.min(questions.length - 1, activeIndex + 1))}>Next</Button>}</> : <Button loading={actionBusy} disabled={!autosave.ready || nextRetrying} onClick={() => visibleQuestion.position === loadedPaper.total_questions - 1 ? setDialog("submit") : void advance()}>{nextRetrying ? "Reconnecting…" : visibleQuestion.position === loadedPaper.total_questions - 1 ? "Submit exam" : "Next question"}</Button>}</footer> : null}
      {dialog === "blank" ? <ExamDialog title="Move on without an answer?" body="You can't come back to this question." confirm="Continue without an answer" busy={actionBusy} error={actionError} onClose={() => { setDialog(null); setActionError(null); }} onConfirm={() => { setDialog(null); void advance(true); }} /> : null}
      {dialog === "submit" ? <ExamDialog title="Submit your exam?" body={`You can't change your answers after you submit.${unansweredCount > 0 && loadedPaper?.navigation_mode === "free" ? ` ${unansweredCount} ${unansweredCount === 1 ? "question is" : "questions are"} not answered.` : ""}`} confirm="Submit exam" busy={actionBusy} error={actionError} onClose={() => { setDialog(null); setActionError(null); }} onConfirm={() => void submitAttempt("manual")} /> : null}
    </main>
  );
}
