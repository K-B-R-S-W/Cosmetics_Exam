"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { Button } from "@/components/ui/Button";
import type { CandidateMe } from "@/lib/candidate-types";
import { langFor } from "@/lib/lang";

export function ConfirmScreen() {
  const router = useRouter();
  const { loadMe, resetCandidateSession } = useCandidate();
  const [me, setMe] = useState<CandidateMe | null>(null);
  const [failed, setFailed] = useState(false);

  function retry() {
    setFailed(false);
    loadMe().then(setMe).catch(() => setFailed(true));
  }
  useEffect(() => {
    loadMe().then(setMe).catch(() => setFailed(true));
  }, [loadMe]);

  async function rejectIdentity() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }).catch(() => null);
    resetCandidateSession();
    router.push("/login?signed_out=1");
  }

  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Is this you?</h1>{failed ? <div className="mt-5 space-y-4"><Notice warning>We couldn&apos;t load your details. Check your connection and try again.</Notice><Button onClick={retry}>Retry</Button></div> : !me ? <div className="mt-6 h-24 animate-pulse bg-selected" aria-label="Loading candidate details" /> : <div className="mt-6"><p className="text-question font-bold">{me.candidate.full_name}</p><p className="mt-1 text-muted">{me.candidate.outlet ? `${me.candidate.outlet} outlet` : "Outlet not listed"}</p><p className="text-muted">{me.candidate.mer_code}</p><p className="mt-5">Exam: <span lang={langFor(me.exam.title)}>{me.exam.title}</span></p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={() => { sessionStorage.setItem("identityConfirmed", "1"); router.push("/rules"); }}>Yes, this is me</Button><Button variant="secondary" onClick={() => void rejectIdentity()}>No, it isn&apos;t</Button></div></div>}</CandidateFrame>;
}
