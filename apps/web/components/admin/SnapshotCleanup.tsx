"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";

type ExamOption = { id: string; title: string; status: string };
type PurgeBody = {
  eligible: number;
  deleted: number;
  failed: number;
  remaining: number;
  dry_run: boolean;
  error?: { code?: string; message?: string };
};

export function SnapshotCleanup() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState("");
  const [preview, setPreview] = useState<PurgeBody>();
  const [result, setResult] = useState<PurgeBody>();
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/exams", { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { items?: ExamOption[] };
        if (!response.ok) throw new Error("exam_options_failed");
        setExams((body.items ?? []).filter((exam) => exam.status === "ended" || exam.status === "finalized"));
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError("Exam options could not be loaded. You can still check all completed exams.");
        }
      }
    })();
    return () => controller.abort();
  }, []);

  async function callPurge(dryRun: boolean): Promise<PurgeBody | null> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/snapshots/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(examId ? { exam_id: examId } : {}),
          dry_run: dryRun,
          ...(!dryRun ? { confirm: true } : {}),
        }),
      });
      const body = await response.json() as PurgeBody;
      if (!response.ok) {
        if (response.status === 503 && body.error?.code === "service_unavailable") setDisabled(true);
        setError(body.error?.message ?? "Snapshot cleanup could not be completed.");
        return null;
      }
      return body;
    } catch {
      setError("Can't reach the server. Check the connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setResult(undefined);
    const body = await callPurge(true);
    if (body) setPreview(body);
  }

  function confirmDelete() {
    if (!preview?.eligible) return;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("[data-safe-action]")?.focus();
  }

  async function remove() {
    const body = await callPurge(false);
    if (!body) return;
    dialog.current?.close();
    setPreview(undefined);
    setResult(body);
  }

  return (
    <section className="mt-10 border-t border-hairline pt-6" aria-labelledby="snapshot-cleanup-title">
      <h3 id="snapshot-cleanup-title" className="text-question font-bold">Snapshot cleanup</h3>
      <p className="mt-2">Delete snapshots older than 14 days. Event records stay.</p>
      <p className="mt-1 text-sm text-muted">Snapshots are also deleted automatically after 14 days.</p>
      <label className="mt-4 block max-w-xl font-bold">
        Exam
        <select
          className="mt-2 block min-h-11 w-full rounded-control border border-line bg-surface px-3 font-normal"
          value={examId}
          disabled={busy || disabled}
          onChange={(event) => { setExamId(event.target.value); setPreview(undefined); setResult(undefined); }}
        >
          <option value="">All completed exams</option>
          {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
        </select>
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" loading={busy} disabled={disabled} onClick={() => void check()}>Check</Button>
        {preview && preview.eligible > 0 ? <Button variant="destructive" disabled={busy || disabled} onClick={confirmDelete}>Delete snapshots</Button> : null}
      </div>
      {preview ? <p role="status" className="mt-4 border-l-4 border-line bg-surface p-3">{preview.eligible} snapshots would be deleted.</p> : null}
      {result ? <div role="status" className="mt-4 border-l-4 border-ok bg-ok-tint p-3"><p>Deleted {result.deleted} snapshots. {result.failed} failed.</p>{result.remaining > 0 ? <p className="mt-1 font-bold">Run again to continue.</p> : null}</div> : null}
      {error ? <p role="alert" className="mt-4 border-l-4 border-alert bg-alert-tint p-3">{error}</p> : null}
      <dialog ref={dialog} aria-labelledby="snapshot-delete-title" className="m-auto w-full max-w-lg border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40">
        <h4 id="snapshot-delete-title" className="text-question font-bold">Delete {preview?.eligible ?? 0} snapshots?</h4>
        <p className="mt-3">The photos are removed. The event records stay.</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="destructive" loading={busy} onClick={() => void remove()}>Delete snapshots</Button>
          <Button variant="secondary" data-safe-action onClick={() => dialog.current?.close()}>Cancel</Button>
        </div>
      </dialog>
    </section>
  );
}
