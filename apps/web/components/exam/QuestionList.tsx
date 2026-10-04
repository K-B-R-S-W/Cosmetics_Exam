"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import type { CandidateQuestion } from "@/lib/candidate-types";
import type { DraftAnswer } from "@/components/exam/QuestionCard";

function answerStatus(question: CandidateQuestion, answer: DraftAnswer | undefined): string {
  const answered = question.type === "mcq"
    ? Boolean(answer?.selected_option_id)
    : Boolean(answer?.answer_text?.trim());
  if (answer?.flagged) return answered ? "Answered, flagged" : "Flagged";
  return answered ? "Answered" : "Not answered";
}

function Items({ questions, answers, activeIndex, onSelect }: {
  questions: CandidateQuestion[];
  answers: Record<string, DraftAnswer>;
  activeIndex: number;
  onSelect(index: number): void;
}) {
  return <>{questions.map((question, index) => <button key={question.id} type="button" className={`flex min-h-11 w-full items-center justify-between border-l-2 px-3 py-2 text-left ${index === activeIndex ? "border-ink bg-selected" : "border-transparent"}`} aria-current={index === activeIndex ? "step" : undefined} onClick={() => onSelect(index)}><span>Question {index + 1}</span><span className="text-sm text-muted">{answerStatus(question, answers[question.id])}</span></button>)}</>;
}

export function QuestionList({ questions, answers, activeIndex, onSelect, drawerOpen, onDrawerOpen }: {
  questions: CandidateQuestion[];
  answers: Record<string, DraftAnswer>;
  activeIndex: number;
  onSelect(index: number): void;
  drawerOpen: boolean;
  onDrawerOpen(open: boolean): void;
}) {
  const triggerId = "candidate-question-drawer-trigger";
  const focusTrigger = () => document.getElementById(triggerId)?.focus();
  const answered = questions.filter((question) => answerStatus(question, answers[question.id]).startsWith("Answered")).length;
  useEffect(() => {
    if (!drawerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDrawerOpen(false);
        requestAnimationFrame(focusTrigger);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawerOpen, onDrawerOpen]);
  const selectFromDrawer = (index: number) => {
    onSelect(index);
    onDrawerOpen(false);
    requestAnimationFrame(focusTrigger);
  };
  return (
    <>
      <Button id={triggerId} variant="secondary" className="candidate-question-drawer-trigger" aria-expanded={drawerOpen} onClick={() => onDrawerOpen(true)}>Questions ({answered}/{questions.length})</Button>
      <nav aria-label="Questions" className="candidate-question-sidebar w-60 shrink-0 border-r border-hairline bg-surface p-3">
        <Items questions={questions} answers={answers} activeIndex={activeIndex} onSelect={onSelect} />
      </nav>
      {drawerOpen ? <div className="fixed inset-0 z-20 bg-paper p-5" role="dialog" aria-modal="true" aria-label="Questions"><div className="mb-4 flex items-center justify-between"><h2 className="text-title font-bold">Questions</h2><Button variant="secondary" onClick={() => { onDrawerOpen(false); requestAnimationFrame(focusTrigger); }}>Close</Button></div><Items questions={questions} answers={answers} activeIndex={activeIndex} onSelect={selectFromDrawer} /></div> : null}
    </>
  );
}

export { answerStatus };
