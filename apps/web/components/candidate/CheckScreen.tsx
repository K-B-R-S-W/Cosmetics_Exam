"use client";

import { useRouter } from "next/navigation";
import { CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { useCandidateLiveKit } from "@/components/candidate/LiveKitContext";
import { Button } from "@/components/ui/Button";
import { useState } from "react";

export function CheckScreen() {
  const router = useRouter();
  const { state, setCheckPassed } = useCandidate();
  const media = useCandidateLiveKit();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempted, setAttempted] = useState(false);

  async function allowMedia() {
    setBusy(true);
    setFailed(false);
    const connected = await media.acquireAndConnect();
    setBusy(false);
    setAttempted(true);
    setFailed(!connected);
  }

  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">Pre-exam check</h1><div className="mt-5"><Notice>Temporary camera and microphone check. The complete device check arrives in Phase 5.</Notice></div><div className="mt-6 flex flex-wrap gap-3"><Button variant="secondary" loading={busy} onClick={() => void allowMedia()}>Allow camera and mic</Button><Button disabled={!attempted && media.status !== "connected"} onClick={() => { setCheckPassed(true); router.push(state?.phase === "live" ? "/exam" : "/waiting"); }}>Continue</Button></div>{media.status === "connected" ? <p className="mt-3" role="status">Camera and microphone are connected.</p> : null}{failed ? <p className="mt-3 text-warn" role="alert">Camera or microphone could not connect. Check the browser permission and try again. Your exam can continue.</p> : null}</CandidateFrame>;
}
