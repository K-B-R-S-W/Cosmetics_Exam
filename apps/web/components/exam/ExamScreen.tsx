"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CandidateErrorScreen, CandidatePaperError, useCandidate } from "@/components/candidate/CandidateContext";
import { QuestionCard, type DraftAnswer } from "@/components/exam/QuestionCard";
import { QuestionList, answerStatus } from "@/components/exam/QuestionList";
import { BATCH_THREE_NOTE, SaveIndicator } from "@/components/exam/SaveIndicator";
import { Timer } from "@/components/exam/Timer";
import { Button } from "@/components/ui/Button";
import type { PaperBody } from "@/lib/candidate-types";
import { langFor } from "@/lib/lang";
import { refineServerClock } from "@/lib/time";

function initialAnswers(paper: PaperBody): Record<string, DraftAnswer> {
  return Object.fromEntries(paper.questions.map((question) => {
    const saved = paper.answers[question.id];
    return [question.id, {
      answer_text: saved?.answer_text ?? null,
      selected_option_id: saved?.selected_option_id ?? null,
      flagged: saved?.flagged ?? false,
    }];
  }));
}

export function isTransientPaperFailure(error: unknown): boolean {
  return !(error instanceof CandidatePaperError) || error.status >= 500 || error.code === "service_unavailable";
}

export function ExamScreen() {
  const router = useRouter();
  const { state, me, paper, loadMe, loadPaper, refreshState } = useCandidate();
  const [loadedPaper, setLoadedPaper] = useState<PaperBody | null>(paper);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>(() => paper ? initialAnswers(paper) : {});
  const [activeIndex, setActiveIndex] = useState(0);
  const [summary, setSummary] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(!paper);
  const [transientError, setTransientError] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [retryCycle, setRetryCycle] = useState(0);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [locallyExpired, setLocallyExpired] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryVisibleTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFatalError(null);
    try {
      const next = await loadPaper();
      refineServerClock(next.server_time);
      setTransientError(false);
      setShowRetry(false);
      if (retryVisibleTimer.current !== null) {
        window.clearTimeout(retryVisibleTimer.current);
        retryVisibleTimer.current = null;
      }
      setLoadedPaper(next);
      setAnswers(initialAnswers(next));
      // generate_paper changes acknowledged -> in_progress; keep route state current.
      await refreshState().catch(() => null);
    } catch (error) {
      if (isTransientPaperFailure(error)) {
        setTransientError(true);
        setRetryCycle((value) => value + 1);
        if (retryVisibleTimer.current === null) retryVisibleTimer.current = window.setTimeout(() => setShowRetry(true), 8000);
      }
      else if (error instanceof CandidatePaperError) {
        const next = await refreshState().catch(() => null);
        if (error.code === "not_acknowledged") router.push("/rules");
        else if (error.code === "attempt_closed") router.push("/done");
        else if (error.code === "exam_not_live") router.push("/waiting");
        else if (error.code === "exam_closed" && next?.attempt.status === "in_progress") setLocallyExpired(true);
        else setFatalError(error.code);
      }
    } finally {
      setLoading(false);
    }
  }, [loadPaper, refreshState, router]);

  useEffect(() => { if (!me) void loadMe().catch(() => null); }, [loadMe, me]);
  useEffect(() => {
    if (loadedPaper) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, loadedPaper]);
  useEffect(() => {
    if (!transientError) return;
    const retry = window.setTimeout(() => void load(), 5000);
    return () => window.clearTimeout(retry);
  }, [load, retryCycle, transientError]);
  useEffect(() => () => {
    if (retryVisibleTimer.current !== null) window.clearTimeout(retryVisibleTimer.current);
  }, []);
  useEffect(() => {
    const keepHere = () => window.history.pushState(null, "", window.location.href);
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", keepHere);
    return () => window.removeEventListener("popstate", keepHere);
  }, []);
  useEffect(() => { if (!summary) headingRef.current?.focus(); }, [activeIndex, summary]);

  const locked = locallyExpired || state?.phase === "closed";
  const questions = useMemo(() => loadedPaper?.questions ?? [], [loadedPaper]);
  // Free mode deliberately starts locally at zero and ignores PaperBody.current_position.
  const visibleQuestion = loadedPaper?.navigation_mode === "sequential" ? questions[0] : questions[activeIndex];
  const answeredCount = useMemo(() => questions.filter((question) => answerStatus(question, answers[question.id]).startsWith("Answered")).length, [answers, questions]);

  if (!state) return <main className="exam-shell"><p className="m-auto text-muted">Loading…</p></main>;
  if (fatalError === "exam_has_no_questions") return <CandidateErrorScreen title="This exam has no questions yet." body="Tell the exam team." signOut />;
  if (fatalError === "exam_closed" && state.attempt.status === "acknowledged") return <CandidateErrorScreen title="This exam has ended." body="The exam is closed." signOut />;
  if (transientError) return <main className="exam-shell"><section className="m-auto max-w-md p-6"><h1 tabIndex={-1} className="text-title font-bold">Loading your exam…</h1><p className="mt-4 text-muted">We couldn&apos;t load the exam yet.</p>{showRetry ? <Button className="mt-6" onClick={() => void load()}>Retry</Button> : null}</section></main>;

  return (
    <main className="exam-shell bg-paper">
      <header className="exam-strip flex min-h-14 items-center justify-between gap-4 border-b border-hairline bg-surface px-5 py-2">
        <div className="exam-strip-title min-w-0">
          <p className="truncate font-bold" lang={langFor(state.exam.title)}>{state.exam.title}</p>
          {me ? <p className="truncate text-xs text-muted">{me.candidate.full_name} · {me.candidate.mer_code}</p> : null}
        </div>
        <p className="shrink-0 text-sm">{loadedPaper?.navigation_mode === "sequential" && visibleQuestion ? `Question ${visibleQuestion.position + 1} of ${loadedPaper.total_questions}` : `${loadedPaper?.total_questions ?? state.exam.question_count} questions · ${answeredCount} answered`}</p>
        <div className="flex shrink-0 items-center gap-4"><SaveIndicator /><Timer deadline={state.attempt.deadline} onExpired={() => setLocallyExpired(true)} /></div>
      </header>
      {locked ? (
        <section className="m-auto max-w-md p-6 text-center"><h1 tabIndex={-1} className="text-title font-bold">Time is up</h1></section>
      ) : loading || !loadedPaper || !visibleQuestion ? (
        <section className="m-auto p-6"><h1 tabIndex={-1} className="text-title font-bold">Loading your exam…</h1></section>
      ) : summary ? (
        <section className="exam-scroll-region mx-auto w-full max-w-[68ch] p-6"><h1 tabIndex={-1} className="text-title font-bold">Review your answers</h1><ul className="mt-6 space-y-2">{questions.filter((question) => answerStatus(question, answers[question.id]) !== "Answered").map((question) => <li key={question.id}><Button variant="quiet" onClick={() => { setActiveIndex(question.position); setSummary(false); }}>Question {question.position + 1}: {answerStatus(question, answers[question.id])}</Button></li>)}</ul>{questions.every((question) => answerStatus(question, answers[question.id]) === "Answered") ? <p className="mt-6">All {questions.length} questions are answered.</p> : null}<div className="mt-8 flex justify-between gap-4"><Button variant="secondary" onClick={() => setSummary(false)}>Back to questions</Button><Button disabled title={BATCH_THREE_NOTE}>Submit exam</Button></div></section>
      ) : (
        <div className="exam-content flex min-h-0">
          {loadedPaper.navigation_mode === "free" ? <QuestionList questions={questions} answers={answers} activeIndex={activeIndex} onSelect={setActiveIndex} drawerOpen={drawerOpen} onDrawerOpen={setDrawerOpen} /> : null}
          <section className="exam-scroll-region flex-1 p-6">
            <QuestionCard key={visibleQuestion.id} question={visibleQuestion} answer={answers[visibleQuestion.id] ?? { answer_text: null, selected_option_id: null, flagged: false }} disabled={false} headingRef={headingRef} onChange={(answer) => setAnswers((current) => ({ ...current, [visibleQuestion.id]: answer }))} />
            {loadedPaper.navigation_mode === "free" ? <div className="mx-auto mt-5 flex max-w-[68ch] justify-end"><Button variant="secondary" aria-pressed={answers[visibleQuestion.id]?.flagged ?? false} onClick={() => setAnswers((current) => ({ ...current, [visibleQuestion.id]: { ...(current[visibleQuestion.id] ?? { answer_text: null, selected_option_id: null, flagged: false }), flagged: !(current[visibleQuestion.id]?.flagged ?? false) } }))}>{answers[visibleQuestion.id]?.flagged ? "Remove flag" : "Flag for review"}</Button></div> : null}
          </section>
        </div>
      )}
      {!locked && loadedPaper && visibleQuestion && !summary ? <footer className="exam-bottom-bar flex min-h-16 items-center justify-end gap-3 border-t border-hairline bg-surface px-5 py-2">{loadedPaper.navigation_mode === "free" ? <><Button variant="secondary" disabled={activeIndex === 0} onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}>Previous</Button>{activeIndex === questions.length - 1 ? <Button onClick={() => setSummary(true)}>Review and submit</Button> : <Button onClick={() => setActiveIndex((value) => Math.min(questions.length - 1, value + 1))}>Next</Button>}</> : <Button disabled title={BATCH_THREE_NOTE}>{visibleQuestion.position === loadedPaper.total_questions - 1 ? "Submit exam" : "Next question"}</Button>}</footer> : null}
    </main>
  );
}
