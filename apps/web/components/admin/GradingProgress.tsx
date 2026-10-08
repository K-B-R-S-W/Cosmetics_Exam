"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

type Progress = { runs: Array<{ id: string; status: string; pause_reason?: string | null }>; queue: Record<string, number>; keys: Array<{ label: string; status: string; cooldown_until: string | null; used: number | null; limit: number | null }>; logs: Array<{ id: number; event: string; detail: string | null; at: string }>; not_graded: number };

export function GradingProgress({ examId, examStatus, attempts }: { examId: string; examStatus: string; attempts: Array<{ id: string; label: string }> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Progress>(); const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false); const [message, setMessage] = useState<string>();
  const load = useCallback(async () => {
    try { const response = await fetch(`/api/admin/grading?exam_id=${examId}`); if (!response.ok) throw new Error(); setData(await response.json() as Progress); setError(undefined); }
    catch { setError("Grading status is unavailable."); }
  }, [examId]);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0); let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => { if (document.visibilityState === "visible") { if (!timer) timer = setInterval(() => void load(), 10_000); } else if (timer) { clearInterval(timer); timer = undefined; } };
    update(); document.addEventListener("visibilitychange", update); return () => { clearTimeout(initial); if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [load]);
  async function resume(runId: string) { await fetch(`/api/admin/grading/${runId}/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failed_only: true }) }); await load(); }
  async function startGrading() {
    setStarting(true); setError(undefined);
    try {
      const response = await fetch(`/api/admin/exams/${examId}/grade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chunk_size: 10, mcq_only: false }) });
      const payload = await response.json() as { estimated_calls?: number; error?: { message?: string } };
      if (!response.ok) { setError(payload.error?.message ?? "Grading could not be started."); return; }
      dialog.current?.close();
      setMessage(`Grading started. Estimated Gemini calls: ${payload.estimated_calls ?? 0}. Confirm current limits in AI Studio.`);
      await load();
    } catch { setError("Can't reach the server. Check the connection and try again."); }
    finally { setStarting(false); }
  }
  const total = data ? Object.values(data.queue).reduce((sum, value) => sum + value, 0) : 0;
  const done = (data?.queue.done ?? 0) + (data?.queue.failed ?? 0);
  const activeRun = data?.runs.some((run) => run.status === "running" || run.status === "paused") ?? false;
  return <section className="space-y-5">
    {error ? <p role="alert" className="text-alert">{error}</p> : null}
    {message ? <p role="status" className="border-l-4 border-ok bg-ok-tint p-3">{message}</p> : null}
    {data && examStatus === "finalized" && !activeRun ? <Button onClick={() => dialog.current?.showModal()}>Start grading</Button> : null}
    {examStatus !== "finalized" ? <p className="font-bold">End the exam first</p> : null}
    <Link className="inline-block underline" href={`/admin/exams/${examId}/questions`}>Answer keys and bulk regrade</Link>
    <label className="block font-bold">Grading progress<progress className="mt-2 block w-full" max={Math.max(1, total)} value={done}>{done} / {total}</progress></label>
    <div className="grid gap-3 sm:grid-cols-4">{["pending", "running", "done", "failed"].map((status) => <div className="border border-line bg-surface p-4" key={status}><strong>{status}</strong><p className="text-title">{data?.queue[status] ?? 0}</p></div>)}</div>
    {data?.not_graded ? <p className="border-l-4 border-warning bg-warning-tint p-3">{data.not_graded} questions not graded.</p> : null}
    <h2 className="text-question font-bold">Runs</h2>{data?.runs.map((run) => <div className="flex items-center gap-3 border-b border-hairline py-2" key={run.id}><span>{run.status}{run.pause_reason ? ` (${run.pause_reason})` : ""}</span>{["paused", "failed"].includes(run.status) ? <Button variant="secondary" onClick={() => void resume(run.id)}>Resume failed jobs</Button> : null}</div>)}
    <h2 className="text-question font-bold">Keys</h2><ul>{data?.keys.map((key) => <li key={key.label}>{key.label}: {key.status}{typeof key.used === "number" && typeof key.limit === "number" ? ` — ${key.used} / ${key.limit}` : ""}</li>)}</ul>
    <h2 className="text-question font-bold">Attempts</h2><ul>{attempts.map((attempt) => <li key={attempt.id}><Link className="underline" href={`/admin/results/${attempt.id}`}>{attempt.label}</Link></li>)}</ul>
    <h2 className="text-question font-bold">Recent grading log</h2><ol>{data?.logs.map((log) => <li key={log.id}>{log.event}{log.detail ? ` — ${log.detail}` : ""}</li>)}</ol>
    <dialog ref={dialog} className="m-auto w-full max-w-lg border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40">
      <h2 className="text-question font-bold">Start grading?</h2>
      <p className="mt-3">MCQs are scored in code. Gemini grades non-empty written answers in chunks of up to 10. Confirm current limits in AI Studio first.</p>
      <div className="mt-6 flex justify-end gap-3"><Button loading={starting} onClick={() => void startGrading()}>Start grading</Button><Button variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button></div>
    </dialog>
  </section>;
}
