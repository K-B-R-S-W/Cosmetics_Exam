"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { formatColombo } from "@/lib/format-time";

type ExamChoice = { id: string; title: string; status: string; scheduled_start_at: string | null };
type ErrorBody = { error?: { code?: string; message?: string; details?: { retry_after_s?: number; exams?: ExamChoice[] } } };

const COPY: Record<string, string> = {
  invalid_credentials: "Your MER code or ID number doesn't match our records. Check both and try again. If it still doesn't work, ask the exam team.",
  exam_closed: "This exam has ended.",
  no_exam_available: "No exam is open for you right now. Ask the exam team.",
  not_assigned: "You aren't assigned to that exam. Ask the exam team.",
  already_submitted: "You have already submitted this exam, so you can't sign in again.",
};

export function LoginForm() {
  const router = useRouter();
  const { refreshState, resetCandidateSession } = useCandidate();
  const search = useSearchParams();
  const [mer, setMer] = useState("");
  const [nic, setNic] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(search.get("signed_out") === "1" ? "You were signed out. Check your MER code and ID number, or ask the exam team." : "");
  const [choices, setChoices] = useState<ExamChoice[] | null>(null);
  const [selected, setSelected] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(0);
  const pickerNic = useRef("");
  const banner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  const minutes = Math.max(0, Math.ceil((retryUntil - now) / 60_000));

  async function login(examId?: string) {
    setBusy(true);
    setMessage("");
    const value = choices ? pickerNic.current : nic;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mer_code: mer, nic: value, ...(examId ? { exam_id: examId } : {}) }),
      });
      const body = (await response.json()) as ErrorBody & { next?: "confirm" | "check" };
      if (response.ok) {
        pickerNic.current = "";
        setNic("");
        resetCandidateSession();
        await refreshState();
        router.push(body.next === "confirm" ? "/confirm" : "/check");
        return;
      }
      const code = body.error?.code ?? "network";
      if (code === "multiple_exams") {
        pickerNic.current = value;
        setNic("");
        setChoices(body.error?.details?.exams ?? []);
        setSelected("");
        return;
      }
      pickerNic.current = "";
      if (code === "invalid_credentials") setNic("");
      if (code === "rate_limited") {
        const seconds = Math.max(1, body.error?.details?.retry_after_s ?? 60);
        setRetryUntil(Date.now() + seconds * 1000);
        setNow(Date.now());
        setMessage(`Too many tries. Wait ${Math.ceil(seconds / 60)} minutes, then try again, or ask the exam team.`);
      } else {
        setMessage(COPY[code] ?? "We can't reach the server. Check your internet connection and try again.");
      }
      requestAnimationFrame(() => banner.current?.focus());
    } catch {
      pickerNic.current = "";
      setMessage("We can't reach the server. Check your internet connection and try again.");
      requestAnimationFrame(() => banner.current?.focus());
    } finally {
      if (choices) pickerNic.current = "";
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void login();
  }

  if (choices) {
    return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Choose your exam</h1><fieldset className="mt-6 space-y-3"><legend className="sr-only">Exam</legend>{choices.map((exam) => <label key={exam.id} className="flex min-h-11 cursor-pointer gap-3 border border-line bg-surface p-3"><input type="radio" name="exam" value={exam.id} checked={selected === exam.id} onChange={() => setSelected(exam.id)} /><span><strong lang="en">{exam.title}</strong><span className="block text-sm text-muted">{exam.scheduled_start_at ? formatColombo(exam.scheduled_start_at) : "Starts when the exam team begins it"}</span></span></label>)}</fieldset><div className="mt-6 flex gap-3"><Button variant="quiet" onClick={() => { pickerNic.current = ""; setChoices(null); setSelected(""); }}>Back</Button><Button disabled={!selected} loading={busy} onClick={() => void login(selected)}>Continue</Button></div></CandidateFrame>;
  }

  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Sign in to your exam</h1>{message ? <div ref={banner} tabIndex={-1} className="mt-5"><Notice warning>{message}</Notice></div> : null}<form className="mt-6 space-y-5" onSubmit={submit} aria-busy={busy || undefined}><Field id="mer-code" label="MER code" value={mer} onChange={(event) => setMer(event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} readOnly={busy} required maxLength={64} /><Field id="nic" label="ID number" type={show ? "text" : "password"} value={nic} onChange={(event) => setNic(event.target.value)} autoComplete="off" inputMode="text" readOnly={busy} required maxLength={20} trailingControl={<button type="button" className="min-h-11 px-3 text-md" aria-pressed={show} onClick={() => setShow((value) => !value)}>{show ? "Hide" : "Show"}</button>} /><Button className="w-full" type="submit" loading={busy} disabled={minutes > 0}>{minutes > 0 ? `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "Sign in"}</Button><p className="text-sm text-muted">Having trouble? Ask the exam team.</p></form></CandidateFrame>;
}
