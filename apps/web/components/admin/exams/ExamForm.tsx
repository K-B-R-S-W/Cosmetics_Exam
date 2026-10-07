"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ExamTabs } from "@/components/admin/exams/ExamTabs";
import { AdminExamControls } from "@/components/admin/AdminExamControls";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import {
  EXAM_DURATION_MAX,
  EXAM_DURATION_MIN,
  EXAM_INSTRUCTIONS_MAX_LENGTH,
  EXAM_TITLE_MAX_LENGTH,
  FLAG_THRESHOLD_MAX,
  FLAG_THRESHOLD_MIN,
  colomboInputToUtc,
  utcToColomboInput,
  type ExamItem,
  type ExamWarning,
} from "@/lib/exams";

interface ErrorBody { error?: { code?: string; message?: string; details?: { missing?: string[] } | Array<{ path: string; message: string }> | null } }

export function ExamForm({ examId }: { examId: string | null }) {
  const router = useRouter();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const editing = examId !== null;
  const [exam, setExam] = useState<ExamItem>();
  const [warnings, setWarnings] = useState<ExamWarning[]>([]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [duration, setDuration] = useState(45);
  const [navigation, setNavigation] = useState<"free" | "sequential">("free");
  const [shuffle, setShuffle] = useState(false);
  const [threshold, setThreshold] = useState(10);
  const [practice, setPractice] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!examId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/exams/${examId}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { exam?: ExamItem; warnings?: ExamWarning[] } & ErrorBody;
        if (!response.ok || !body.exam) throw new Error(body.error?.message ?? "Exam could not be loaded.");
        setExam(body.exam); setWarnings(body.warnings ?? []); setTitle(body.exam.title); setInstructions(body.exam.instructions ?? ""); setStartLocal(utcToColomboInput(body.exam.scheduled_start_at)); setDuration(body.exam.duration_min); setNavigation(body.exam.navigation_mode); setShuffle(body.exam.shuffle); setThreshold(body.exam.flag_threshold); setPractice(body.exam.is_practice);
      } catch (loadError) { if ((loadError as Error).name !== "AbortError") setError((loadError as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [examId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const locked = exam ? ["live", "ended", "finalized"].includes(exam.status) : false;
  const thresholdLocked = exam?.status === "finalized";
  const mark = <T,>(setter: (value: T) => void, value: T) => { setter(value); setDirty(true); setMessage(undefined); };
  const fullPayload = () => ({ title, instructions, scheduled_start_at: startLocal ? colomboInputToUtc(startLocal) : null, duration_min: duration, navigation_mode: navigation, shuffle, flag_threshold: threshold, is_practice: practice });
  const editablePayload = () => exam?.status === "finalized" ? { title } : locked ? { title, flag_threshold: threshold } : fullPayload();
  function requestNavigation(href: string) {
    if (!dirty) {
      router.push(href);
      return;
    }
    setPendingHref(href);
    leaveDialog.current?.showModal();
  }

  async function save(event?: FormEvent, status?: "draft" | "scheduled") {
    event?.preventDefault(); setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const payload = { ...editablePayload(), ...(status ? { status } : {}) };
      const response = await fetch(editing ? `/api/admin/exams/${examId}` : "/api/admin/exams", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { exam?: ExamItem } & ErrorBody;
      if (!response.ok || !body.exam) { setError(body.error?.message ?? "Exam could not be saved."); return; }
      setDirty(false); setExam(body.exam); setMessage(status === "scheduled" ? "Exam scheduled." : status === "draft" ? "Exam moved back to draft." : "Saved.");
      if (!editing) { router.push(`/admin/exams/${body.exam.id}`); router.refresh(); }
    } catch (saveError) { setError((saveError as Error).message === "invalid_colombo_datetime" ? "Enter a valid Colombo date and time." : "Can't reach the server. Check the connection and try again."); }
    finally { setSaving(false); }
  }

  async function removeExam() {
    if (!examId) return; setDeleting(true); setError(undefined);
    try {
      const response = await fetch(`/api/admin/exams/${examId}`, { method: "DELETE" });
      const body = await response.json() as ErrorBody;
      if (!response.ok) { deleteDialog.current?.close(); setError(body.error?.message ?? "Exam could not be deleted."); return; }
      router.push("/admin/exams"); router.refresh();
    } catch { setError("Can't reach the server. Check the connection and try again."); deleteDialog.current?.close(); }
    finally { setDeleting(false); }
  }

  if (loading) return <p className="border-t border-hairline pt-6 text-muted">Loading exam…</p>;
  const missingKeys = warnings.find((warning) => warning.code === "missing_answer_key")?.question_ids.length ?? 0;
  const startTimeReady = Boolean(
    exam?.scheduled_start_at &&
      new Date(exam.scheduled_start_at).getTime() >= renderedAt + 60_000,
  );
  return <section className="border-t border-hairline pt-6" aria-labelledby="exam-form-title">
    <p className="mb-2 text-sm text-muted">Exams</p><h1 id="exam-form-title" className="text-title font-bold">{editing ? title || "Exam settings" : "New exam"}</h1>
    {examId ? <ExamTabs examId={examId} current="settings" onNavigate={requestNavigation} /> : null}
    {exam && (exam.status === "draft" || exam.status === "scheduled") ? <div className="mt-5"><AdminExamControls exam={exam} onChanged={() => { router.push(`/admin/live?exam=${exam.id}`); router.refresh(); }} /></div> : null}
    {exam ? <div className="mt-6 border border-hairline bg-surface p-5"><h2 className="text-question font-bold">Readiness</h2><ul className="mt-3 space-y-2"><li>{exam.question_count >= 1 ? `Questions: ${exam.question_count}` : <><strong>No questions yet.</strong> Question building arrives in Phase 1E.</>}</li><li>{exam.assigned_count >= 1 ? `Candidates: ${exam.assigned_count}` : <><strong>No candidates assigned.</strong> <Link className="underline" href={`/admin/exams/${exam.id}/candidates`}>Assign candidates</Link></>}</li><li>{startTimeReady ? "Start time is at least one minute ahead." : startLocal ? <strong>The start time has passed. Choose a new one.</strong> : <strong>No start time set.</strong>}</li>{missingKeys ? <li className="text-warn">{missingKeys} questions have no answer key yet. You can add them before grading.</li> : <li>Answer keys complete.</li>}</ul></div> : null}
    {locked ? <p className="mt-5 border-l-4 border-warn bg-warn-tint px-4 py-3">Locked while the exam is live. Only the title and flag threshold can change{thresholdLocked ? "; finalized exams lock the threshold too" : ""}.</p> : null}
    {message ? <p role="status" className="mt-5 border-l-4 border-ok bg-ok-tint px-4 py-3">{message}</p> : null}{error ? <p role="alert" className="mt-5 border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}
    <form className="mt-6 max-w-3xl space-y-5" onSubmit={(event) => void save(event)}>
      <Field id="exam-title" label="Title" value={title} maxLength={EXAM_TITLE_MAX_LENGTH} required disabled={saving} onChange={(event) => mark(setTitle, event.target.value)} />
      <label className="block font-bold" htmlFor="exam-instructions">Instructions<textarea id="exam-instructions" className="mt-2 min-h-32 w-full rounded-control border border-line bg-surface p-3 font-normal" value={instructions} maxLength={EXAM_INSTRUCTIONS_MAX_LENGTH} disabled={saving || locked} onChange={(event) => mark(setInstructions, event.target.value)} /></label><p className="-mt-3 text-sm text-muted">Shown to candidates on the rules screen.</p>
      <div><Field id="exam-start" label="Start date and time (Colombo time)" type="datetime-local" value={startLocal} disabled={saving || locked} onChange={(event) => mark(setStartLocal, event.target.value)} /><p className="mt-2 text-sm text-muted">The waiting room opens when candidates sign in. The exam starts at this time, or sooner if you press Start now.</p></div>
      <Field id="exam-duration" label="Duration (minutes)" type="number" min={EXAM_DURATION_MIN} max={EXAM_DURATION_MAX} value={duration} disabled={saving || locked} onChange={(event) => mark(setDuration, Number(event.target.value))} />
      <fieldset disabled={saving || locked}><legend className="font-bold">Navigation</legend><label className="mt-2 flex min-h-11 items-center gap-3"><input type="radio" checked={navigation === "free"} onChange={() => mark(setNavigation, "free")} /> <span><strong>Free</strong> — Candidates can go back and forth between questions</span></label><label className="flex min-h-11 items-center gap-3"><input type="radio" checked={navigation === "sequential"} onChange={() => mark(setNavigation, "sequential")} /> <span><strong>Sequential</strong> — One question at a time. No going back.</span></label></fieldset>
      <label className="flex min-h-11 items-center gap-3 font-bold"><input type="checkbox" checked={shuffle} disabled={saving || locked} onChange={(event) => mark(setShuffle, event.target.checked)} /> Shuffle question and multiple-choice option order for each candidate</label>
      <div><Field id="flag-threshold" label="Flag threshold" type="number" min={FLAG_THRESHOLD_MIN} max={FLAG_THRESHOLD_MAX} value={threshold} disabled={saving || thresholdLocked} onChange={(event) => mark(setThreshold, Number(event.target.value))} /><p className="mt-2 text-sm text-muted">A candidate turns red at this number and amber at half of it.</p></div>
      <label className="flex min-h-11 items-center gap-3 font-bold"><input type="checkbox" checked={practice} disabled={saving || locked} onChange={(event) => mark(setPractice, event.target.checked)} /> This is a rehearsal exam.</label>
      <div className="flex flex-wrap gap-3 pt-2"><Button type="submit" loading={saving} disabled={!dirty && editing}>Save</Button><Button variant="secondary" onClick={() => requestNavigation("/admin/exams")}>Cancel</Button>{exam?.status === "draft" ? <Button variant="secondary" loading={saving} onClick={() => void save(undefined, "scheduled")}>Schedule exam</Button> : null}{exam?.status === "scheduled" ? <Button variant="secondary" loading={saving} onClick={() => void save(undefined, "draft")}>Move back to draft</Button> : null}{exam?.status === "draft" ? <Button className="ml-auto" variant="destructive" onClick={() => deleteDialog.current?.showModal()}>Delete exam</Button> : null}</div>
    </form>
    <dialog ref={deleteDialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">Delete this exam?</h2><p className="mt-3">“{title}” and its {exam?.question_count ?? 0} questions will be deleted. This cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><Button variant="destructive" loading={deleting} onClick={() => void removeExam()}>Delete exam</Button><Button variant="secondary" autoFocus onClick={() => deleteDialog.current?.close()}>Keep exam</Button></div></dialog>
    <dialog ref={leaveDialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">You have unsaved changes.</h2><div className="mt-6 flex justify-end gap-3"><Button variant="destructive" onClick={() => { leaveDialog.current?.close(); setDirty(false); if (pendingHref) router.push(pendingHref); }}>Leave without saving</Button><Button variant="secondary" autoFocus onClick={() => { leaveDialog.current?.close(); setPendingHref(undefined); }}>Stay</Button></div></dialog>
  </section>;
}
