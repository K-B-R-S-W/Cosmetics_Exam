"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

type Progress = { runs: Array<{ id: string; status: string; pause_reason?: string | null }>; queue: Record<string, number>; keys: Array<{ label: string; status: string; cooldown_until: string | null; used: number | null; limit: number | null }>; logs: Array<{ id: number; event: string; detail: string | null; at: string }>; not_graded: number };

export function GradingProgress({ examId, attempts }: { examId: string; attempts: Array<{ id: string; label: string }> }) {
  const [data, setData] = useState<Progress>(); const [error, setError] = useState<string>();
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
  const total = data ? Object.values(data.queue).reduce((sum, value) => sum + value, 0) : 0;
  const done = (data?.queue.done ?? 0) + (data?.queue.failed ?? 0);
  return <section className="space-y-5">
    {error ? <p role="alert" className="text-alert">{error}</p> : null}
    <label className="block font-bold">Grading progress<progress className="mt-2 block w-full" max={Math.max(1, total)} value={done}>{done} / {total}</progress></label>
    <div className="grid gap-3 sm:grid-cols-4">{["pending", "running", "done", "failed"].map((status) => <div className="border border-line bg-surface p-4" key={status}><strong>{status}</strong><p className="text-title">{data?.queue[status] ?? 0}</p></div>)}</div>
    {data?.not_graded ? <p className="border-l-4 border-warning bg-warning-tint p-3">{data.not_graded} questions not graded.</p> : null}
    <h2 className="text-question font-bold">Runs</h2>{data?.runs.map((run) => <div className="flex items-center gap-3 border-b border-hairline py-2" key={run.id}><span>{run.status}{run.pause_reason ? ` (${run.pause_reason})` : ""}</span>{["paused", "failed"].includes(run.status) ? <Button variant="secondary" onClick={() => void resume(run.id)}>Resume failed jobs</Button> : null}</div>)}
    <h2 className="text-question font-bold">Keys</h2><ul>{data?.keys.map((key) => <li key={key.label}>{key.label}: {key.status}{typeof key.used === "number" && typeof key.limit === "number" ? ` — ${key.used} / ${key.limit}` : ""}</li>)}</ul>
    <h2 className="text-question font-bold">Attempts</h2><ul>{attempts.map((attempt) => <li key={attempt.id}><Link className="underline" href={`/admin/results/${attempt.id}`}>{attempt.label}</Link></li>)}</ul>
    <h2 className="text-question font-bold">Recent grading log</h2><ol>{data?.logs.map((log) => <li key={log.id}>{log.event}{log.detail ? ` — ${log.detail}` : ""}</li>)}</ol>
  </section>;
}
