"use client";

import { useRouter } from "next/navigation";
import { CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { Button } from "@/components/ui/Button";

export function CheckScreen() {
  const router = useRouter();
  const { state, setCheckPassed } = useCandidate();
  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Pre-exam check</h1><div className="mt-5"><Notice>Placeholder, replaced in Phase 5</Notice></div><Button className="mt-6" onClick={() => { setCheckPassed(true); router.push(state?.phase === "live" ? "/exam" : "/waiting"); }}>Continue</Button></CandidateFrame>;
}
