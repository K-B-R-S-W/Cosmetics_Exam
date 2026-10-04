"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import type { CandidateQuestion, SavedAnswer } from "@/lib/candidate-types";
import { langFor } from "@/lib/lang";

export type DraftAnswer = Pick<SavedAnswer, "answer_text" | "selected_option_id" | "flagged">;

function RichText({ html }: { html: string }) {
  return (
    <div
      className="space-y-3 [&_h2]:text-title [&_h2]:font-bold [&_h3]:text-question [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
      lang={langFor(html)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function QuestionCard({
  question,
  answer,
  disabled,
  onChange,
  headingRef,
}: {
  question: CandidateQuestion;
  answer: DraftAnswer;
  disabled: boolean;
  onChange(answer: DraftAnswer): void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const marks = question.marks === 1 ? "1 mark" : `${question.marks} marks`;
  const textLength = answer.answer_text?.length ?? 0;

  return (
    <article className="mx-auto w-full max-w-[68ch]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h1 ref={headingRef} tabIndex={-1} className="text-title font-bold">Question {question.position + 1}</h1>
        <span className="shrink-0 text-sm text-muted">{marks}</span>
      </div>
      <div className="text-question"><RichText html={question.body_html} /></div>
      {question.image ? (
        <div className="mt-6 min-h-32">
          {imageFailed ? (
            <div className="border border-line bg-surface p-4">
              <p>Image could not be loaded</p>
              <Button className="mt-3" variant="secondary" onClick={() => { setImageFailed(false); setImageAttempt((value) => value + 1); }}>Retry</Button>
            </div>
          ) : (
            // The URL is always the authenticated same-origin candidate image route.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={imageAttempt} src={question.image.url} alt={question.image.alt_text} className="h-auto max-w-full" onError={() => setImageFailed(true)} />
          )}
        </div>
      ) : null}
      {question.type === "mcq" ? (
        <fieldset className="mt-6 space-y-3" disabled={disabled}>
          <legend className="sr-only">Choose one answer for question {question.position + 1}</legend>
          {(question.options ?? []).map((option, index) => {
            const selected = answer.selected_option_id === option.id;
            return (
              <label key={option.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border bg-surface px-4 py-3 ${selected ? "border-2 border-ink bg-selected" : "border-line"}`}>
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option.id}
                  checked={selected}
                  onChange={() => onChange({ ...answer, selected_option_id: option.id })}
                />
                <span aria-hidden="true" className="font-bold">{String.fromCharCode(65 + index)}</span>
                <div className="flex-1" lang={langFor(option.text_html)} dangerouslySetInnerHTML={{ __html: option.text_html }} />
                {selected ? <span aria-hidden="true">✓</span> : null}
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className="mt-6">
          <label htmlFor={`answer-${question.id}`} className="block font-bold">Your answer</label>
          <textarea
            id={`answer-${question.id}`}
            className="mt-2 min-h-72 w-full rounded-control border border-line bg-surface p-4 text-answer"
            value={answer.answer_text ?? ""}
            maxLength={20_000}
            disabled={disabled}
            lang={langFor(answer.answer_text ?? question.body_html)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => onChange({ ...answer, answer_text: event.currentTarget.value })}
          />
          {textLength >= 19_000 ? <p className={`mt-2 text-sm ${textLength >= 20_000 ? "text-warn" : "text-muted"}`}>{20_000 - textLength} characters left</p> : null}
        </div>
      )}
    </article>
  );
}
