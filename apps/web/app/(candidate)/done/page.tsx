"use client";

import { useEffect, useRef, useState } from "react";

import { CandidateFrame, useCandidate } from "@/components/candidate/CandidateContext";
import { useCandidateLiveKit } from "@/components/candidate/LiveKitContext";
import { getAnswerDraftStore } from "@/lib/indexeddb";
import { langFor } from "@/lib/lang";

const REASON_COPY = {
  manual: "Thank you. Your answers were received.",
  auto: "Time ran out, so your exam was submitted automatically. Answers that reached the server before then were kept.",
  forced: "The exam team ended the exam. Answers saved before then were submitted.",
} as const;

export default function DonePage() {
  const { state } = useCandidate();
  const media = useCandidateLiveKit();
  const [snapshot] = useState(() => ({
    attemptId: state?.attempt.id ?? null,
    title: state?.exam.title ?? "",
    reason: state?.attempt.submit_reason ?? "manual",
  }));
  const completed = useRef(false);

  useEffect(() => {
    if (completed.current) return;
    completed.current = true;
    void (async () => {
      await media.stop();
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      if (snapshot.attemptId) await getAnswerDraftStore().clearAttempt(snapshot.attemptId).catch(() => undefined);
      await fetch("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }).catch(() => null);
    })();
  }, [media, snapshot.attemptId]);

  const reason = REASON_COPY[snapshot.reason as keyof typeof REASON_COPY] ?? REASON_COPY.manual;
  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Your exam is submitted</h1><p className="mt-3 font-bold" lang={langFor(snapshot.title)}>{snapshot.title}</p><p className="mt-5 text-muted">{reason}</p><p className="mt-3 text-muted">You can close this window.</p></CandidateFrame>;
}
