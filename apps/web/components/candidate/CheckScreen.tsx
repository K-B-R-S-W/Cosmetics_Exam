"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CandidateFrame, useCandidate } from "@/components/candidate/CandidateContext";
import { useDeviceCheck } from "@/components/candidate/DeviceCheckContext";
import { useCandidateLiveKit } from "@/components/candidate/LiveKitContext";
import { Timer } from "@/components/exam/Timer";
import { Button } from "@/components/ui/Button";
import { enterExamFullscreen } from "@/components/exam/FullscreenOverlay";
import { hasExtendedScreen, isAndroid, isChrome, isDesktopSiteMode, mediaTracksReady } from "@/lib/pre-exam-check";
import { syncServerClock } from "@/lib/time";

type StepState = "Waiting" | "Checking" | "Passed" | "Needs attention";
type ExtendedScreen = Screen & { isExtended?: boolean };
type UserAgentNavigator = Navigator & { userAgentData?: { brands?: Array<{ brand: string }>; platform?: string } };

function CheckStep({ number, title, state, children }: { number: number; title: string; state: StepState; children?: React.ReactNode }) {
  return <li className="border-t border-hairline py-4"><div className="flex items-start justify-between gap-4"><div><span className="mr-3 inline-flex size-7 items-center justify-center rounded-full border border-line" aria-hidden="true">{number}</span><strong>{title}</strong></div><span aria-live="polite">{state}</span></div>{children ? <div className="ml-10 mt-3">{children}</div> : null}</li>;
}

function navigatorEvidence() {
  const value = navigator as UserAgentNavigator;
  return { userAgent: value.userAgent, maxTouchPoints: value.maxTouchPoints, userAgentData: value.userAgentData };
}

export function CheckScreen() {
  const router = useRouter();
  const { state, setCheckPassed, markExamHandoff, refreshState } = useCandidate();
  const media = useCandidateLiveKit();
  const device = useDeviceCheck();
  const [browserPassed] = useState(() => typeof navigator !== "undefined" && isChrome(navigatorEvidence()));
  const [mediaAttempted, setMediaAttempted] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [fullscreenPassed, setFullscreenPassed] = useState(() => typeof document !== "undefined" && Boolean(document.fullscreenElement));
  const [fullscreenError, setFullscreenError] = useState(false);
  const [connection, setConnection] = useState<"waiting" | "checking" | "passed" | "failed">("waiting");
  const [desktopSite, setDesktopSite] = useState(false);
  const [secondScreen, setSecondScreen] = useState(false);
  const mediaPassed = media.status === "connected" && mediaTracksReady(media.mediaTracks);

  useEffect(() => {
    const changed = () => setFullscreenPassed(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  async function allowMedia() {
    setMediaBusy(true); setMediaError(false);
    const connected = await media.acquireAndConnect();
    setMediaAttempted(true); setMediaError(!connected);
    setMediaBusy(false);
  }

  async function checkConnectionAndDisplay() {
    setConnection("checking");
    try {
      await syncServerClock();
      await refreshState();
      setConnection("passed");
    } catch { setConnection("failed"); }
    const evidence = navigatorEvidence();
    const android = isAndroid(evidence);
    setDesktopSite(isDesktopSiteMode({ ...evidence, innerWidth: window.innerWidth, screenWidth: screen.width }));
    setSecondScreen(hasExtendedScreen(screen as ExtendedScreen, android));
  }

  async function enterFullscreen() {
    setFullscreenError(false);
    try {
      await enterExamFullscreen();
      const active = Boolean(document.fullscreenElement);
      setFullscreenPassed(active);
      if (!active) { setFullscreenError(true); return; }
      void device.requestWakeLock();
      await checkConnectionAndDisplay();
    } catch { setFullscreenPassed(false); setFullscreenError(true); }
  }

  const displayChecked = connection === "passed";
  const ready = browserPassed && mediaAttempted && mediaPassed && fullscreenPassed && connection === "passed" && !desktopSite;
  function continueToExam() {
    if (!document.fullscreenElement) { setFullscreenPassed(false); setFullscreenError(true); return; }
    markExamHandoff();
    setCheckPassed(true);
    router.push(state?.phase === "live" ? "/exam" : "/waiting");
  }

  return <CandidateFrame><div className="flex items-start justify-between gap-4"><div><h1 tabIndex={-1} className="text-title font-bold">Check your setup</h1><p className="mt-2 text-muted">Complete each step before continuing.</p></div>{state?.phase === "live" ? <div className="text-right"><p className="text-sm text-muted">The exam is running. Finish this check to continue.</p><Timer deadline={state.attempt.deadline} /></div> : null}</div>
    <ol className="mt-6 border-b border-hairline">
      <CheckStep number={1} title="Google Chrome" state={browserPassed ? "Passed" : "Needs attention"}>{!browserPassed ? <p className="text-warn">This exam only works in Google Chrome. Open this page in Chrome to continue.</p> : null}</CheckStep>
      <CheckStep number={2} title="Camera and mic" state={mediaBusy ? "Checking" : mediaPassed ? "Passed" : mediaAttempted ? "Needs attention" : "Waiting"}><Button variant="secondary" loading={mediaBusy} onClick={() => void allowMedia()}>Allow camera and mic</Button>{mediaError ? <p className="mt-2 text-warn" role="alert">Camera or microphone access is blocked or unavailable. Check the browser permission and try again.</p> : mediaPassed ? <p className="mt-2">Camera preview and microphone are ready.</p> : null}</CheckStep>
      <CheckStep number={3} title="Fullscreen" state={fullscreenPassed ? "Passed" : fullscreenError ? "Needs attention" : "Waiting"}><Button variant="secondary" disabled={!mediaPassed} onClick={() => void enterFullscreen()}>Enter fullscreen</Button>{fullscreenError ? <p className="mt-2 text-warn" role="alert">Fullscreen didn&apos;t start. Press Enter fullscreen again. If it still fails, ask the exam team.</p> : null}</CheckStep>
      <CheckStep number={4} title="Connection" state={connection === "checking" ? "Checking" : connection === "passed" ? "Passed" : connection === "failed" ? "Needs attention" : "Waiting"}>{connection === "failed" ? <><p className="text-warn" role="alert">We can&apos;t reach the exam server. Check your internet, then press Check again.</p><Button className="mt-2" variant="quiet" onClick={() => void checkConnectionAndDisplay()}>Check again</Button></> : null}</CheckStep>
      <CheckStep number={5} title="Screens and display" state={!displayChecked ? "Waiting" : desktopSite ? "Needs attention" : "Passed"}>{desktopSite ? <><p className="text-warn" role="alert">Turn off &quot;Desktop site&quot; in Chrome&apos;s menu, then press Check again.</p><Button className="mt-2" variant="quiet" onClick={() => void checkConnectionAndDisplay()}>Check again</Button></> : secondScreen ? <p className="text-warn">A second screen was found. Disconnect it before the exam starts. You can still continue.</p> : null}</CheckStep>
    </ol>
    <Button className="mt-6" disabled={!ready} onClick={continueToExam}>Continue</Button>
  </CandidateFrame>;
}
