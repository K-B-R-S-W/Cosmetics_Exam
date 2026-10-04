"use client";

import { TiptapEditor } from "@/components/editor/TiptapEditor";
import { Button } from "@/components/ui/Button";
import type { EditorOption } from "@/components/admin/questions/question-types";
import type { QuestionFieldErrors } from "@/components/admin/questions/question-types";
import { OPTION_TEXT_MAX } from "@/lib/questions";

interface McqOptionsProps {
  correctOptionId: string | null;
  disabled?: boolean;
  keyDisabled?: boolean;
  errors?: QuestionFieldErrors;
  onChange: (options: EditorOption[]) => void;
  onCorrectChange: (id: string | null) => void;
  options: EditorOption[];
}

export function McqOptions({ correctOptionId, disabled = false, errors = {}, keyDisabled = false, onChange, onCorrectChange, options }: McqOptionsProps) {
  function update(id: string, text_html: string) {
    onChange(options.map((option) => option.id === id ? { ...option, text_html } : option));
  }
  function remove(id: string) {
    if (correctOptionId === id) onCorrectChange(null);
    onChange(options.filter((option) => option.id !== id));
  }
  return <fieldset className="space-y-4">
    <legend className="text-question font-bold">Options</legend>
    {options.map((option, index) => <div className="border border-hairline bg-paper p-3" key={option.id}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-bold">{String.fromCharCode(65 + index)}</span>
        <label className="flex min-h-11 items-center gap-2 font-bold"><input type="radio" name="correct-option" checked={correctOptionId === option.id} disabled={keyDisabled} onChange={() => onCorrectChange(option.id)} /> Correct answer</label>
        <Button variant="quiet" disabled={disabled || options.length <= 2} onClick={() => remove(option.id)}>Remove</Button>
      </div>
      <TiptapEditor ariaLabel={`Option ${String.fromCharCode(65 + index)} text`} disabled={disabled} error={errors[`options.${index}.text_html`]} headings={false} maxLength={OPTION_TEXT_MAX} value={option.text_html} onChange={(html) => update(option.id, html)} />
    </div>)}
    <Button variant="secondary" disabled={disabled || options.length >= 10} onClick={() => onChange([...options, { id: crypto.randomUUID(), text_html: "<p></p>" }])}>Add option</Button>
    <p className="text-sm text-muted">Candidates see letters by their own position, and the order can be shuffled.</p>
  </fieldset>;
}
