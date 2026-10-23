"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ExamDeleteCounts } from "@/lib/exam-delete";
import type { ExamStatus } from "@/lib/exams";

interface PreviewBody {
  exam?: { id: string; title: string; status: ExamStatus };
  counts?: ExamDeleteCounts;
  error?: { message?: string };
}

export function DeleteExamButton({ examId, status, onDeleted, className }: {
  examId: string;
  status: ExamStatus;
  onDeleted(): void;
  className?: string;
}) {
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<PreviewBody>();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (status === "live" || status === "ended") return null;

  async function openDialog() {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/exams/${examId}/delete-preview`, { cache: "no-store" });
      const body = await response.json() as PreviewBody;
      if (!response.ok || !body.exam || !body.counts) throw new Error(body.error?.message ?? "Delete details could not be loaded.");
      setPreview(body);
      dialog.current?.showModal();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteExam() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/exams/${examId}`, { method: "DELETE" });
      const body = await response.json() as { warnings?: string[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Exam could not be deleted.");
      dialog.current?.close();
      if (body.warnings?.length) toast.error(body.warnings.join(" "));
      else toast.success("Exam deleted.");
      onDeleted();
    } catch (error) {
      dialog.current?.close();
      toast.error((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <Button className={className} variant="destructive" loading={loading} onClick={() => void openDialog()}>Delete exam</Button>
    <dialog ref={dialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 text-left text-ink shadow-dialog backdrop:bg-ink/40">
      <h2 className="text-question font-bold">Delete this exam?</h2>
      <p className="mt-3">Are you sure you want to delete this exam and its results too? This cannot be undone.</p>
      {preview?.exam ? <p className="mt-3 font-bold">{preview.exam.title}</p> : null}
      {preview?.counts ? <dl className="mt-3 grid grid-cols-2 gap-2"><dt>Questions</dt><dd>{preview.counts.questions}</dd><dt>Assigned candidates</dt><dd>{preview.counts.assigned_candidates}</dd><dt>Attempts</dt><dd>{preview.counts.attempts}</dd><dt>Results</dt><dd>{preview.counts.results}</dd></dl> : null}
      {preview?.exam?.status === "finalized" ? <Link className="mt-4 inline-flex min-h-11 items-center underline" href={`/api/admin/results/export?exam_id=${encodeURIComponent(examId)}`}>Export results CSV first</Link> : null}
      <div className="mt-6 flex justify-end gap-3"><Button variant="destructive" loading={deleting} onClick={() => void deleteExam()}>Delete exam and results</Button><Button variant="secondary" autoFocus onClick={() => dialog.current?.close()}>Cancel</Button></div>
    </dialog>
  </>;
}
