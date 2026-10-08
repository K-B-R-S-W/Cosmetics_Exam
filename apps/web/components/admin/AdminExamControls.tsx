"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LiveAttempt, LiveExam } from "@/lib/admin-live";

type ErrorBody = { error?: { code?: string; message?: string } };

export function AdminExamControls({ exam, attempts = [], onChanged }: { exam: LiveExam; attempts?: LiveAttempt[]; onChanged(): void | Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"start" | "extend" | "broadcast" | "end" | "grade">("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [audience, setAudience] = useState<"all" | "custom">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [toast, setToast] = useState<string>();

  function open(next: typeof kind) {
    setKind(next);
    setError(undefined);
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("[data-safe-action]")?.focus();
  }
  async function submit() {
    setBusy(true); setError(undefined);
    const route = kind === "start" ? "start" : kind === "extend" ? "extend" : kind === "broadcast" ? "broadcast" : kind === "grade" ? "grade" : "force-end";
    const body = kind === "extend" ? { minutes } : kind === "broadcast" ? { message, audience, ...(audience === "custom" ? { candidate_ids: selected } : {}) } : kind === "end" ? { confirm: true } : kind === "grade" ? { chunk_size: 10, mcq_only: false } : undefined;
    try {
      const response = await fetch(`/api/admin/exams/${exam.id}/${route}`, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json() as ErrorBody & { recipient_count?: number; estimated_calls?: number };
      if (!response.ok) {
        if (response.status === 503 && (kind === "extend" || kind === "broadcast" || kind === "grade")) await onChanged();
        setError(payload.error?.message ?? "The action could not be completed.");
        return;
      }
      dialog.current?.close();
      setToast(kind === "start" ? "Exam started." : kind === "extend" ? `Added ${minutes} minutes for everyone.` : kind === "broadcast" ? "Sent." : kind === "grade" ? `Grading started. Estimated Gemini calls: ${payload.estimated_calls ?? 0}. Confirm current limits in AI Studio.` : "Exam ended. Collecting final answers.");
      await onChanged();
    } catch { setError("Can't reach the server. Check the connection and try again."); }
    finally { setBusy(false); }
  }

  return <div>
    <div className="flex flex-wrap gap-2">
      {exam.status === "draft" || exam.status === "scheduled" ? <Button onClick={() => open("start")}>Start now</Button> : null}
      {exam.status === "scheduled" || exam.status === "live" ? <Button variant="secondary" onClick={() => open("broadcast")}>Announcement</Button> : null}
      {exam.status === "live" ? <Button variant="secondary" onClick={() => open("extend")}>Extend time</Button> : null}
      {exam.status === "live" ? <Button variant="destructive" onClick={() => open("end")}>End exam</Button> : null}
      {exam.status === "finalized" ? <Button onClick={() => open("grade")}>Start grading</Button> : null}
    </div>
    {exam.status === "draft" ? <p className="mt-2 text-sm text-muted">Schedule the exam to send messages.</p> : null}
    {toast ? <p role="status" className="mt-3 border-l-4 border-ok bg-ok-tint p-3">{toast}</p> : null}
    <dialog ref={dialog} className="m-auto w-full max-w-lg border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40">
      <h2 className="text-question font-bold">{kind === "start" ? "Start the exam now?" : kind === "extend" ? "Extend time" : kind === "broadcast" ? "Send announcement" : kind === "grade" ? "Start grading?" : "End the exam for everyone?"}</h2>
      {kind === "start" ? <p className="mt-3">Candidates will have {exam.duration_min} minutes from now.{exam.scheduled_start_at ? " The scheduled start will be replaced." : ""}</p> : null}
      {kind === "extend" ? <label className="mt-4 block font-bold">Minutes<input className="mt-2 block min-h-11 w-full border border-line px-3" type="number" min={1} max={120} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label> : null}
      {kind === "broadcast" ? <><label className="mt-4 block font-bold">Message<textarea className="mt-2 min-h-32 w-full border border-line p-3 font-normal" maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} /></label><p className="text-sm text-muted">{message.length} / 5000</p><fieldset className="mt-3"><legend className="font-bold">Recipients</legend><label className="mr-4"><input type="radio" checked={audience === "all"} onChange={() => setAudience("all")} /> All assigned candidates</label><label><input type="radio" checked={audience === "custom"} onChange={() => setAudience("custom")} /> Selected candidates</label>{audience === "custom" ? <div className="mt-2 max-h-40 overflow-auto">{attempts.map((item) => <label key={item.candidate.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={selected.includes(item.candidate.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.candidate.id] : current.filter((id) => id !== item.candidate.id))} /> {item.candidate.mer_code} {item.candidate.full_name}</label>)}</div> : null}</fieldset><p className="mt-3 text-sm text-muted">Each candidate sees this once for 5 seconds. You can send as many announcements as needed.</p></> : null}
      {kind === "end" ? <p className="mt-3">Candidates still working will lock now. Their latest answers can be collected for 15 seconds, then submitted. This cannot be undone.</p> : null}
      {kind === "grade" ? <p className="mt-3">MCQs are scored in code. Gemini grades non-empty written answers in chunks of up to 10. Confirm current limits in AI Studio first.</p> : null}
      {error ? <p role="alert" className="mt-4 text-alert">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-3"><Button variant={kind === "end" ? "destructive" : "primary"} loading={busy} onClick={() => void submit()}>{kind === "start" ? "Start exam" : kind === "extend" ? "Extend time" : kind === "broadcast" ? "Send message" : kind === "grade" ? "Start grading" : "End exam for everyone"}</Button><Button variant="secondary" data-safe-action onClick={() => dialog.current?.close()}>{kind === "start" ? "Not yet" : kind === "end" ? "Keep exam running" : "Cancel"}</Button></div>
    </dialog>
  </div>;
}
