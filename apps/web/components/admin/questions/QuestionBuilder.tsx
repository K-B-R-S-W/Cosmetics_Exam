"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AnswerKeyEditor } from "@/components/admin/questions/AnswerKeyEditor";
import { McqOptions } from "@/components/admin/questions/McqOptions";
import { QuestionImageField } from "@/components/admin/questions/QuestionImageField";
import { questionFieldErrors, type ApiErrorBody, type EditorQuestion, type QuestionFieldErrors } from "@/components/admin/questions/question-types";
import { ExamTabs } from "@/components/admin/exams/ExamTabs";
import { TiptapEditor } from "@/components/editor/TiptapEditor";
import { Button } from "@/components/ui/Button";
import type { ExamStatus } from "@/lib/exams";
import { QUESTION_BODY_MAX } from "@/lib/questions";

interface ExamHeader { id: string; title: string; status: ExamStatus }

export function createQuestionDraft(examId: string, type: "mcq" | "written"): EditorQuestion {
  const options = type === "mcq"
    ? [{ id: crypto.randomUUID(), text_html: "<p></p>" }, { id: crypto.randomUUID(), text_html: "<p></p>" }]
    : [];
  return {
    id: crypto.randomUUID(), exam_id: examId, position: null, type, body_html: "<p></p>", marks: 1, image: null, options,
    answer_key: { correct_option_id: null, model_answer: null, grading_notes: null, calibration: [] }, persisted: false,
  };
}

export function questionKeyComplete(question: EditorQuestion): boolean {
  return question.type === "mcq"
    ? Boolean(question.answer_key.correct_option_id && question.options.some((option) => option.id === question.answer_key.correct_option_id))
    : Boolean(question.answer_key.model_answer?.trim());
}

function cloneQuestion(question: EditorQuestion): EditorQuestion {
  return structuredClone(question);
}

function previewText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled question";
}

function payload(question: EditorQuestion, marksInput: string) {
  const image = question.image ? {
    path: question.image.path,
    alt_text: question.image.alt_text,
    mime: question.image.mime,
    size_bytes: question.image.size_bytes,
  } : null;
  return {
    id: question.id, exam_id: question.exam_id, type: question.type, position: question.position,
    body_html: question.body_html, marks: marksInput.trim() ? Number(marksInput) : 1, image,
    options: question.options.map(({ id, text_html }) => ({ id, text_html })), answer_key: question.answer_key,
  };
}

export function QuestionBuilder({ examId }: { examId: string }) {
  const router = useRouter();
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const [persistedImagePaths, setPersistedImagePaths] = useState<Record<string, string | null>>({});
  const [savedQuestions, setSavedQuestions] = useState<Record<string, EditorQuestion>>({});
  const [exam, setExam] = useState<ExamHeader>();
  const [questions, setQuestions] = useState<EditorQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [marksInput, setMarksInput] = useState("1");
  const [keyMissingOnly, setKeyMissingOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [keyLockedByGrading, setKeyLockedByGrading] = useState(false);
  const [dragId, setDragId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<QuestionFieldErrors>({});

  const selected = questions.find((question) => question.id === selectedId);
  const locked = exam ? ["live", "ended", "finalized"].includes(exam.status) : false;
  const missingCount = questions.filter((question) => !questionKeyComplete(question)).length;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void (async () => {
      setLoading(true); setError(undefined);
      try {
        const [examResponse, questionsResponse] = await Promise.all([
          fetch(`/api/admin/exams/${examId}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/admin/questions?exam_id=${examId}`, { cache: "no-store", signal: controller.signal }),
        ]);
        const examBody = await examResponse.json() as { exam?: ExamHeader } & ApiErrorBody;
        const questionBody = await questionsResponse.json() as { items?: Array<Omit<EditorQuestion, "persisted">> } & ApiErrorBody;
        if (!examResponse.ok || !examBody.exam) throw new Error(examBody.error?.message ?? "Exam could not be loaded.");
        if (!questionsResponse.ok) throw new Error(questionBody.error?.message ?? "Questions could not be loaded.");
        const loaded = (questionBody.items ?? []).map((question) => ({ ...question, persisted: true }));
        setPersistedImagePaths(Object.fromEntries(loaded.map((question) => [question.id, question.image?.path ?? null])));
        setSavedQuestions(Object.fromEntries(loaded.map((question) => [question.id, cloneQuestion(question)])));
        setExam(examBody.exam); setQuestions(loaded); setSelectedId(loaded[0]?.id);
        setMarksInput(loaded[0] ? String(loaded[0].marks) : "1"); setDirty(false);
      } catch (loadError) { if ((loadError as Error).name !== "AbortError") setError((loadError as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })(), 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [examId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function guard(action: () => void) {
    if (!dirty) { action(); return; }
    pendingAction.current = action; leaveDialog.current?.showModal();
  }
  function selectQuestion(id: string) {
    guard(() => { const next = questions.find((question) => question.id === id); setSelectedId(id); setMarksInput(next ? String(next.marks) : "1"); setKeyLockedByGrading(false); setFieldErrors({}); setMessage(undefined); setError(undefined); });
  }
  function addQuestion(type: "mcq" | "written") {
    guard(() => { const draft = createQuestionDraft(examId, type); setQuestions((items) => [...items, draft]); setSelectedId(draft.id); setMarksInput(""); setKeyLockedByGrading(false); setFieldErrors({}); setDirty(true); setMessage(undefined); setError(undefined); });
  }
  function updateSelected(change: (question: EditorQuestion) => EditorQuestion) {
    setQuestions((items) => items.map((question) => question.id === selectedId ? change(question) : question)); setFieldErrors({}); setDirty(true); setMessage(undefined);
  }
  function discardSelectedChanges() {
    if (!selectedId) return;
    const snapshot = savedQuestions[selectedId];
    if (snapshot) {
      setQuestions((items) => items.map((question) => question.id === selectedId ? cloneQuestion(snapshot) : question));
      setMarksInput(String(snapshot.marks));
    } else {
      setQuestions((items) => items.filter((question) => question.id !== selectedId));
    }
    setFieldErrors({}); setDirty(false); setMessage(undefined); setError(undefined);
  }
  async function reloadExamStatus() {
    const response = await fetch(`/api/admin/exams/${examId}`, { cache: "no-store" });
    const body = await response.json() as { exam?: ExamHeader } & ApiErrorBody;
    if (response.ok && body.exam) setExam(body.exam);
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setError(undefined); setFieldErrors({}); setMessage(undefined);
    try {
      if (imageBusy) throw new Error("Wait for the image upload to finish.");
      const body = locked ? { question_id: selected.id, ...selected.answer_key } : payload(selected, marksInput);
      const url = locked ? "/api/admin/answer-keys" : selected.persisted ? `/api/admin/questions/${selected.id}` : "/api/admin/questions";
      const method = locked ? "PUT" : selected.persisted ? "PATCH" : "POST";
      const requestBody = method === "PATCH"
        ? (({ body_html, marks, image, options, answer_key }) => ({ body_html, marks, image, options, answer_key }))(body as ReturnType<typeof payload>)
        : body;
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
      const result = await response.json() as { question?: Omit<EditorQuestion, "persisted">; answer_key?: EditorQuestion["answer_key"]; regrade_needed?: boolean } & ApiErrorBody;
      if (!response.ok) {
        if (result.error?.code === "grading_in_progress") {
          setKeyLockedByGrading(true);
          throw new Error("Answer keys are locked while grading is running, so every candidate is graded against the same key. You can edit them once it finishes.");
        }
        if (result.error?.code === "exam_locked") {
          await reloadExamStatus();
          discardSelectedChanges();
          throw new Error(result.error.message ?? "This exam has started, so its questions cannot change.");
        }
        const nextFieldErrors = questionFieldErrors(result.error?.details);
        if (Object.keys(nextFieldErrors).length > 0) {
          setFieldErrors(nextFieldErrors);
          return;
        }
        throw new Error(result.error?.message ?? "The question could not be saved.");
      }
      const saved = locked
        ? { ...selected, answer_key: result.answer_key ?? selected.answer_key }
        : result.question ? { ...result.question, persisted: true } : selected;
      setQuestions((items) => items.map((question) => question.id === selected.id ? saved : question));
      setSavedQuestions((snapshots) => ({ ...snapshots, [saved.id]: cloneQuestion(saved) }));
      setPersistedImagePaths((paths) => ({ ...paths, [saved.id]: saved.image?.path ?? null }));
      setMarksInput(String(saved.marks)); setDirty(false);
      setMessage(result.regrade_needed ? "Scores already exist for this question. Regrade it so the new key is used." : locked ? "Answer key saved." : "Question saved.");
    } catch (saveError) { setError((saveError as Error).message); }
    finally { setSaving(false); }
  }

  async function removeQuestion() {
    if (!selected) return;
    if (!selected.persisted) { setQuestions((items) => items.filter((item) => item.id !== selected.id)); setSelectedId(questions.find((item) => item.id !== selected.id)?.id); setDirty(false); deleteDialog.current?.close(); return; }
    setSaving(true); setError(undefined);
    try {
      const response = await fetch(`/api/admin/questions/${selected.id}`, { method: "DELETE" });
      const body = await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(body.error?.message ?? "The question could not be deleted.");
      const remaining = questions.filter((question) => question.id !== selected.id);
      setSavedQuestions((snapshots) => { const next = { ...snapshots }; delete next[selected.id]; return next; });
      setQuestions(remaining); setSelectedId(remaining[0]?.id); setMarksInput(remaining[0] ? String(remaining[0].marks) : "1"); setDirty(false); setMessage("Question deleted."); deleteDialog.current?.close();
    } catch (deleteError) { setError((deleteError as Error).message); deleteDialog.current?.close(); }
    finally { setSaving(false); }
  }

  async function persistOrder(next: EditorQuestion[], before: EditorQuestion[]) {
    setQuestions(next); setError(undefined);
    try {
      const response = await fetch("/api/admin/questions/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: examId, ordered_ids: next.map((question) => question.id) }) });
      const body = await response.json() as ApiErrorBody; if (!response.ok) throw new Error(body.error?.message ?? "Questions could not be reordered.");
      setQuestions((items) => items.map((question, position) => ({ ...question, position }))); setMessage("Question order saved.");
      setSavedQuestions((snapshots) => Object.fromEntries(Object.entries(snapshots).map(([id, question]) => [id, { ...question, position: next.findIndex((item) => item.id === id) }])));
    } catch (reorderError) { setQuestions(before); setError((reorderError as Error).message); }
  }
  async function reorder(id: string, direction: -1 | 1) {
    if (locked || dirty || keyMissingOnly || questions.some((question) => !question.persisted)) return;
    const index = questions.findIndex((question) => question.id === id); const target = index + direction;
    if (index < 0 || target < 0 || target >= questions.length) return;
    const before = questions; const next = [...questions]; [next[index], next[target]] = [next[target]!, next[index]!];
    await persistOrder(next, before);
  }
  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = questions.findIndex((question) => question.id === dragId); const to = questions.findIndex((question) => question.id === targetId);
    if (from < 0 || to < 0 || locked || dirty || keyMissingOnly || questions.some((question) => !question.persisted)) return;
    const before = questions; const next = [...questions]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved!);
    void persistOrder(next, before); setDragId(undefined);
  }

  if (loading) return <p className="border-t border-hairline pt-6 text-muted">Loading questions…</p>;
  const filtered = keyMissingOnly ? questions.filter((question) => !questionKeyComplete(question)) : questions;
  return <section className="border-t border-hairline pt-6" aria-labelledby="question-builder-title">
    <p className="mb-2 text-sm text-muted">Exams</p><h1 id="question-builder-title" className="text-title font-bold">{exam?.title ?? "Question builder"}</h1>
    <ExamTabs examId={examId} current="questions" onNavigate={(href) => guard(() => router.push(href))} />
    {locked ? <div className="mt-5 border-l-4 border-warn bg-warn-tint px-4 py-3"><p className="font-bold">Questions are locked while the exam is live. You can still edit answer keys.</p><p className="mt-1">Deleting or changing a question now would change the papers candidates already have.</p></div> : null}
    {message ? <p role="status" className="mt-4 border-l-4 border-ok bg-ok-tint px-4 py-3">{message}</p> : null}
    {error ? <p role="alert" className="mt-4 border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}
    <div className="mt-6 grid min-w-[960px] grid-cols-[320px_minmax(0,1fr)] gap-8">
      <nav aria-label="Questions" className="border-r border-hairline pr-5">
        <p className="font-bold">{questions.length} questions · {questions.filter((question) => question.type === "mcq").length} MCQ · {questions.filter((question) => question.type === "written").length} written</p>
        <div className="mt-3 flex gap-2"><Button variant="secondary" disabled={locked} onClick={() => addQuestion("mcq")}>Add MCQ</Button><Button variant="secondary" disabled={locked} onClick={() => addQuestion("written")}>Add written question</Button></div>
        <button type="button" className={`mt-3 min-h-11 border px-3 ${keyMissingOnly ? "border-ink bg-selected" : "border-line bg-surface"}`} aria-pressed={keyMissingOnly} onClick={() => setKeyMissingOnly((value) => !value)}>Show only: Key missing ({missingCount})</button>
        {filtered.length === 0 ? <p className="mt-5 text-muted">{questions.length ? "No questions match this filter." : "No questions yet. Add a multiple-choice or written question to start."}</p> : <ol className="mt-4 space-y-2">
          {filtered.map((question) => { const index = questions.findIndex((item) => item.id === question.id); return <li key={question.id} className={`border ${selectedId === question.id ? "border-2 border-ink bg-selected" : "border-line bg-surface"}`} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(question.id)}>
            <div className="flex min-h-14 items-stretch">
              <button type="button" draggable={!locked && !dirty && !keyMissingOnly} aria-label={`Drag question ${index + 1}`} title="Drag to reorder" className="min-w-11 cursor-grab border-r border-hairline" disabled={locked || dirty || keyMissingOnly} onDragStart={() => setDragId(question.id)}>⋮⋮</button>
              <button type="button" className="min-w-0 flex-1 p-2 text-left" onClick={() => selectQuestion(question.id)}><span className="block font-bold">{index + 1}. {question.type === "mcq" ? "MCQ" : "Written"}</span><span className="block truncate text-sm" lang={/[\u0D80-\u0DFF]/u.test(question.body_html) ? "si" : "en"}>{previewText(question.body_html)}</span><span className="block text-xs text-muted">{questionKeyComplete(question) ? "Key complete" : "Key missing"}</span></button>
              <div className="flex flex-col"><button type="button" className="min-h-7 min-w-11 border-l border-hairline" aria-label={`Move question ${index + 1} up`} disabled={locked || dirty || keyMissingOnly || index === 0} onClick={() => void reorder(question.id, -1)}>↑</button><button type="button" className="min-h-7 min-w-11 border-l border-t border-hairline" aria-label={`Move question ${index + 1} down`} disabled={locked || dirty || keyMissingOnly || index === questions.length - 1} onClick={() => void reorder(question.id, 1)}>↓</button></div>
            </div>
          </li>; })}
        </ol>}
      </nav>
      <div>
        {!selected ? <p className="text-muted">Select a question or add one to begin.</p> : <div className="space-y-6">
          <div><p className="font-bold">{selected.type === "mcq" ? "Multiple-choice question" : "Written question"}</p><p className="text-sm text-muted">The type can&apos;t be changed. To switch, delete the question and add a new one.</p></div>
          <label className="block font-bold">Question text</label><TiptapEditor ariaLabel="Question text" disabled={locked} error={fieldErrors.body_html} maxLength={QUESTION_BODY_MAX} value={selected.body_html} onChange={(body_html) => updateSelected((question) => ({ ...question, body_html }))} />
          <QuestionImageField key={selected.id} disabled={locked} image={selected.image} questionId={selected.id} persistedPath={persistedImagePaths[selected.id] ?? null} onBusyChange={setImageBusy} onChange={(image) => updateSelected((question) => ({ ...question, image }))} />
          <div className="max-w-xs"><label className="block font-bold">Marks<input aria-invalid={Boolean(fieldErrors.marks)} aria-describedby={fieldErrors.marks ? "question-marks-error" : undefined} className="mt-2 min-h-11 w-full border border-line px-3 font-normal" type="number" min="0.01" max="999.99" step="0.25" placeholder="1" disabled={locked} value={marksInput} onChange={(event) => { setMarksInput(event.target.value); setFieldErrors({}); setDirty(true); setMessage(undefined); }} />{fieldErrors.marks ? <span id="question-marks-error" className="mt-1 block text-sm text-alert" role="alert">{fieldErrors.marks}</span> : null}</label><p className="mt-2 text-sm text-muted">Leave empty for 1 mark. Candidates see this next to the question.</p></div>
          {selected.type === "mcq" ? <><div><h2 className="text-question font-bold">Answer key</h2><p className="text-sm text-muted">{questionKeyComplete(selected) ? "Complete" : "Missing"}</p></div><McqOptions disabled={locked} errors={fieldErrors} keyDisabled={keyLockedByGrading} options={selected.options} correctOptionId={selected.answer_key.correct_option_id} onChange={(options) => updateSelected((question) => ({ ...question, options }))} onCorrectChange={(correct_option_id) => updateSelected((question) => ({ ...question, answer_key: { ...question.answer_key, correct_option_id } }))} /></> : <AnswerKeyEditor disabled={keyLockedByGrading} errors={fieldErrors} marks={marksInput.trim() ? Number(marksInput) : 1} value={selected.answer_key} examId={selected.position === null || dirty ? undefined : examId} questionId={selected.position === null || dirty ? undefined : selected.id} onChange={(answer_key) => updateSelected((question) => ({ ...question, answer_key }))} />}
          <div className="flex gap-3 border-t border-hairline pt-5"><Button loading={saving} disabled={imageBusy || keyLockedByGrading || (!locked && Boolean(selected.image?.image_missing)) || (!dirty && selected.persisted)} onClick={() => void save()}>{locked ? "Save answer key" : "Save question"}</Button>{!locked ? <Button variant="destructive" disabled={saving} onClick={() => deleteDialog.current?.showModal()}>Delete question</Button> : null}</div>
        </div>}
      </div>
    </div>
    <dialog ref={deleteDialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">Delete question {selected ? questions.findIndex((question) => question.id === selected.id) + 1 : ""}?</h2><p className="mt-3">This cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><Button variant="destructive" loading={saving} onClick={() => void removeQuestion()}>Delete question</Button><Button variant="secondary" autoFocus onClick={() => deleteDialog.current?.close()}>Keep question</Button></div></dialog>
    <dialog ref={leaveDialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">You have unsaved changes.</h2><div className="mt-6 flex justify-end gap-3"><Button variant="destructive" onClick={() => { leaveDialog.current?.close(); discardSelectedChanges(); const action = pendingAction.current; pendingAction.current = null; action?.(); }}>Leave without saving</Button><Button variant="secondary" autoFocus onClick={() => { leaveDialog.current?.close(); pendingAction.current = null; }}>Stay</Button></div></dialog>
  </section>;
}
