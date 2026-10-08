"use client";

import type { AnswerKeyInput } from "@/lib/questions";
import { Button } from "@/components/ui/Button";
import type { QuestionFieldErrors } from "@/components/admin/questions/question-types";

interface AnswerKeyEditorProps {
  disabled?: boolean;
  errors?: QuestionFieldErrors;
  marks: number;
  onChange: (key: AnswerKeyInput) => void;
  value: AnswerKeyInput;
  examId?: string;
  questionId?: string;
}

export function AnswerKeyEditor({ disabled = false, errors = {}, marks, onChange, value, examId, questionId }: AnswerKeyEditorProps) {
  const calibration = value.calibration;
  const set = <K extends keyof AnswerKeyInput>(key: K, next: AnswerKeyInput[K]) => onChange({ ...value, [key]: next });
  return <section className="space-y-5" aria-labelledby="answer-key-title">
    <div><h2 id="answer-key-title" className="text-question font-bold">Answer key</h2><p className="text-sm text-muted">{value.model_answer?.trim() ? "Complete" : "Missing"}</p></div>
    <label className="block font-bold">Model answer<textarea className="mt-2 min-h-28 w-full border border-line bg-surface p-3 font-normal" maxLength={10_000} disabled={disabled} value={value.model_answer ?? ""} onChange={(event) => set("model_answer", event.target.value || null)} /></label>
    <p className="-mt-3 text-sm text-muted">The ideal answer in one or two sentences. English is best. Sinhala is fine.</p>
    <label className="block font-bold">Grading notes<textarea className="mt-2 min-h-32 w-full border border-line bg-surface p-3 font-normal" maxLength={4_000} disabled={disabled} value={value.grading_notes ?? ""} onChange={(event) => set("grading_notes", event.target.value || null)} /></label>
    <p className="-mt-3 text-sm text-muted">Most important. List the key points and their marks. Say how many are needed for full marks and what to accept or reject.</p>
    <fieldset className="space-y-3"><legend className="font-bold">Calibration examples</legend>
      {calibration.map((example, index) => <div className="grid gap-3 border border-hairline p-3 lg:grid-cols-[1fr_8rem_1fr_auto]" key={index}>
        <label className="font-bold">Answer<textarea className="mt-2 min-h-24 w-full border border-line p-2 font-normal" maxLength={20_000} disabled={disabled} value={example.answer} onChange={(event) => set("calibration", calibration.map((item, itemIndex) => itemIndex === index ? { ...item, answer: event.target.value } : item))} /></label>
        <label className="font-bold">Marks<input aria-invalid={Boolean(errors[`answer_key.calibration.${index}.marks`])} aria-describedby={errors[`answer_key.calibration.${index}.marks`] ? `calibration-${index}-marks-error` : undefined} className="mt-2 min-h-11 w-full border border-line px-2 font-normal" type="number" min="0" max={marks} step="0.25" disabled={disabled} value={example.marks} onChange={(event) => set("calibration", calibration.map((item, itemIndex) => itemIndex === index ? { ...item, marks: Number(event.target.value) } : item))} />{errors[`answer_key.calibration.${index}.marks`] ? <span id={`calibration-${index}-marks-error`} className="mt-1 block text-sm text-alert" role="alert">{errors[`answer_key.calibration.${index}.marks`]}</span> : null}</label>
        <label className="font-bold">Note<textarea className="mt-2 min-h-24 w-full border border-line p-2 font-normal" maxLength={4_000} disabled={disabled} value={example.note} onChange={(event) => set("calibration", calibration.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))} /></label>
        <Button variant="quiet" disabled={disabled} onClick={() => set("calibration", calibration.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
      </div>)}
      <Button variant="secondary" disabled={disabled || calibration.length >= 10} onClick={() => set("calibration", [...calibration, { answer: "", marks: 0, note: "" }])}>Add example</Button>
      <p className="text-sm text-muted">Add 2 to 4 short sample answers with the marks you would give. Use answers you invent, not real staff answers.</p>
    </fieldset>
    <details className="border border-hairline p-4"><summary className="min-h-11 cursor-pointer font-bold">How to write a good answer key</summary><p className="mt-3">Example: For a niacinamide question, list the expected benefit, mechanism and safe-use point, assign marks to each, and say which Sinhala or Singlish wording is acceptable.</p></details>
    {examId && questionId ? <Button variant="secondary" onClick={() => void fetch(`/api/admin/exams/${examId}/regrade-question`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: questionId }) })}>Regrade this question for everyone</Button> : null}
  </section>;
}
