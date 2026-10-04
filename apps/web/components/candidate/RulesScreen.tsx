"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CandidateErrorScreen, CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { Button } from "@/components/ui/Button";
import type { ApiErrorPayload, CandidateMe } from "@/lib/candidate-types";
import { formatColombo } from "@/lib/format-time";
import { langFor } from "@/lib/lang";

const RULES = [
  "Stay in fullscreen and on the exam page for the whole exam.",
  "Don't switch to another tab or window.",
  "Use one screen only.",
  "Keep your camera and microphone on.",
  "Don't copy, paste, or open the right-click menu.",
  "Work alone.",
];

export function RulesScreen() {
  const router = useRouter();
  const { loadMe } = useCandidate();
  const [me, setMe] = useState<CandidateMe | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("identityConfirmed") !== "1") {
      router.replace("/confirm");
      return;
    }
    loadMe().then((value) => {
      if (value.attempt.status !== "not_started") router.replace("/check");
      else setMe(value);
    }).catch(() => setMessage("We can't reach the server. Check your internet connection and try again."));
  }, [loadMe, router]);

  async function accept() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity_confirmed: true, rules_accepted: true }) });
      const body = (await response.json()) as ApiErrorPayload;
      if (response.ok) {
        sessionStorage.removeItem("identityConfirmed");
        router.push("/check");
      } else if (body.error.code === "exam_closed") setClosed(true);
      else if (body.error.code === "already_submitted") router.push("/done");
      else setMessage("We can't reach the server. Check your internet connection and try again.");
    } catch {
      setMessage("We can't reach the server. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (closed) return <CandidateErrorScreen title="This exam is closed." body="The exam is no longer accepting candidates." signOut />;
  return <CandidateFrame wide><h1 tabIndex={-1} className="text-title font-bold">Before you start</h1>{message ? <div className="mt-4"><Notice warning>{message}</Notice></div> : null}{!me ? <p className="mt-6 text-muted">Loading…</p> : <div className="mt-6 space-y-7"><section><p className="font-bold" lang={langFor(me.exam.title)}>{me.exam.title} · {me.exam.question_count} questions · {me.exam.duration_min} minutes</p>{me.exam.scheduled_start_at ? <p className="text-muted">Starts {formatColombo(me.exam.scheduled_start_at)}</p> : null}</section>{me.exam.instructions ? <section><h2 className="text-question font-bold">Instructions from the exam team</h2><p className="mt-2 whitespace-pre-wrap" lang={langFor(me.exam.instructions)}>{me.exam.instructions}</p></section> : null}<section><h2 className="text-question font-bold">How this exam works</h2><p className="mt-2">{me.exam.navigation_mode === "sequential" ? "You answer one question at a time. When you press Next, you can't go back to earlier questions." : "You can move between questions in any order, flag questions to review, and change answers until you submit."}</p><p className="mt-2">Your answers are saved as you type. The timer keeps running even if your connection drops.</p></section><section><h2 className="text-question font-bold">What is monitored</h2><p className="mt-2">Your camera and microphone are watched live by the exam team for the whole exam. If you break a rule, a photo from your camera is saved with a record of what happened. Those photos are deleted after {me.rules.snapshot_retention_days} days.</p></section><section><h2 className="text-question font-bold">Rules</h2><ul className="mt-2 list-disc space-y-1 pl-6">{RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul></section><section><h2 className="text-question font-bold">If a rule is broken</h2><p className="mt-2">If a rule is broken, you will see a warning and the exam team will see a record of it. Nothing happens automatically. The exam team reviews the records and decides what to do.</p></section><section><h2 className="text-question font-bold">Time</h2><p className="mt-2">The timer starts for everyone together. Your answers are saved as you type, but they have to reach the server before the time ends, so reconnect as soon as you can if your connection drops. If you have a problem, tell the exam team. They can add time for you.</p></section><section><h2 className="text-question font-bold">Set up your device</h2><p className="mt-2"><strong>Laptop:</strong> Use a Chrome Guest window. Close other windows. Use one screen. Turn your camera and microphone on.</p><p className="mt-2"><strong>Tablet:</strong> Use Chrome only. Turn Desktop site off. Run the check the day before so Android can ask for camera permission then, not during the exam.</p></section><label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I have read and accept these rules.</span></label><div><Button disabled={!accepted} loading={busy} onClick={() => void accept()}>Accept and continue</Button>{!accepted ? <p className="mt-2 text-sm text-muted">Tick the box to continue.</p> : null}</div></div>}</CandidateFrame>;
}
