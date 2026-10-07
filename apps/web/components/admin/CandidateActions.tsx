"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LiveAttempt } from "@/lib/admin-live";

export function CandidateActions({ attempt, examId, onChanged }: { attempt: LiveAttempt; examId: string; onChanged(): void | Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<"extend" | "submit" | "kick">("extend");
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const closed = attempt.status === "submitted" || attempt.status === "finalized";
  function open(next: typeof action) { setAction(next); setMessage(undefined); dialog.current?.showModal(); }
  async function run() {
    setBusy(true);
    const url = action === "extend" ? `/api/admin/exams/${examId}/extend` : `/api/admin/attempts/${attempt.id}/${action === "submit" ? "force-submit" : "kick"}`;
    const body = action === "extend" ? { minutes, attempt_id: attempt.id } : action === "submit" ? { confirm: true } : undefined;
    try {
      const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json() as { livekit_removed?: boolean; error?: { message?: string } };
      if (!response.ok) { if (response.status === 503 && action === "extend") await onChanged(); setMessage(payload.error?.message ?? "The action failed."); return; }
      dialog.current?.close(); setMessage(action === "kick" && payload.livekit_removed === false ? "Signed out. Their video may stay on the grid for a moment." : action === "submit" ? "Candidate submitted." : `Added ${minutes} minutes.`); await onChanged();
    } catch { setMessage("Can't reach the server."); } finally { setBusy(false); }
  }
  return <div className="mt-5"><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={closed} onClick={() => open("extend")}>Extend time for this candidate</Button><Button variant="secondary" disabled={closed} onClick={() => open("kick")}>Sign out this candidate</Button><Button variant="destructive" disabled={closed} onClick={() => open("submit")}>Submit exam for this candidate</Button></div>{message ? <p role="status" className="mt-2">{message}</p> : null}<dialog ref={dialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">{action === "extend" ? "Extend time" : action === "kick" ? `Sign ${attempt.candidate.full_name} out?` : `Submit ${attempt.candidate.full_name}'s exam now?`}</h2>{action === "extend" ? <input aria-label="Minutes" className="mt-4 min-h-11 border border-line px-3" type="number" min={1} max={120} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /> : <p className="mt-3">{action === "kick" ? "They can sign in again and their time keeps running." : "Their answers so far are submitted and they can't continue."}</p>}<div className="mt-6 flex justify-end gap-3"><Button variant={action === "submit" ? "destructive" : "primary"} loading={busy} onClick={() => void run()}>{action === "extend" ? "Extend time" : action === "kick" ? "Sign out candidate" : "Submit their exam"}</Button><Button variant="secondary" autoFocus onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog></div>;
}
