"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/Button";
import { AnnouncementToast } from "@/components/candidate/AnnouncementToast";
import { useCandidateLiveKit } from "@/components/candidate/LiveKitContext";
import { useDeviceCheck } from "@/components/candidate/DeviceCheckContext";
import { routeFor } from "@/lib/candidate-routing";
import type { ApiErrorPayload, CandidateMe, PaperBody, StateBody } from "@/lib/candidate-types";
import { getAnswerDraftStore } from "@/lib/indexeddb";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useAnnouncements } from "@/hooks/useAnnouncements";

export class CandidatePaperError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "CandidatePaperError";
  }
}

interface CandidateContextValue {
  state: StateBody | null;
  me: CandidateMe | null;
  paper: PaperBody | null;
  checkPassed: boolean;
  setCheckPassed(value: boolean): void;
  refreshState(): Promise<StateBody | null>;
  heartbeatNow(): Promise<StateBody | null>;
  loadMe(): Promise<CandidateMe>;
  loadPaper(force?: boolean): Promise<PaperBody>;
  markExamHandoff(): void;
  hasExamHandoff(): boolean;
  resetCandidateSession(): void;
}

const CandidateContext = createContext<CandidateContextValue | null>(null);

async function payload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function CandidateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { stop: stopMedia } = useCandidateLiveKit();
  const { releaseDeviceCheck } = useDeviceCheck();
  const [state, setState] = useState<StateBody | null>(null);
  const [me, setMe] = useState<CandidateMe | null>(null);
  const [paper, setPaper] = useState<PaperBody | null>(null);
  const [checkPassed, setCheckPassed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(pathname === "/login");
  const mePromise = useRef<Promise<CandidateMe> | null>(null);
  const paperPromise = useRef<Promise<PaperBody> | null>(null);
  const statePromise = useRef<Promise<StateBody | null> | null>(null);
  const stateLoaded = useRef(false);
  const examHandoff = useRef(false);
  const sessionGeneration = useRef(0);
  const activeAttemptId = state?.attempt.id;
  const { current: announcement, reset: resetAnnouncements } = useAnnouncements(state?.announcements ?? [], {
    enabled: pathname === "/waiting" || pathname === "/exam",
    identityKey: activeAttemptId ?? null,
    resetKey: 0,
  });
  const applyHeartbeatState = useCallback((next: StateBody) => {
    setError(null);
    setState(next);
    stateLoaded.current = true;
    setLoaded(true);
  }, []);
  const applyHeartbeatAuthError = useCallback((code: "unauthenticated" | "session_revoked") => {
    setError(code);
    stateLoaded.current = true;
    setLoaded(true);
  }, []);
  const heartbeatNow = useHeartbeat(
    applyHeartbeatState,
    applyHeartbeatAuthError,
    pathname === "/waiting" || pathname === "/exam",
  );
  const markExamHandoff = useCallback(() => { examHandoff.current = true; }, []);
  const hasExamHandoff = useCallback(() => examHandoff.current, []);

  const resetCandidateSession = useCallback(() => {
    void stopMedia();
    void releaseDeviceCheck();
    if (activeAttemptId) void getAnswerDraftStore().clearAttempt(activeAttemptId);
    sessionGeneration.current += 1;
    resetAnnouncements();
    setState(null);
    setMe(null);
    setPaper(null);
    setError(null);
    setCheckPassed(false);
    setLoaded(false);
    mePromise.current = null;
    paperPromise.current = null;
    statePromise.current = null;
    stateLoaded.current = false;
    examHandoff.current = false;
    sessionStorage.removeItem("identityConfirmed");
  }, [activeAttemptId, releaseDeviceCheck, resetAnnouncements, stopMedia]);

  const refreshState = useCallback(() => {
    if (!statePromise.current) {
      const generation = sessionGeneration.current;
      const request = (async () => {
        const response = await fetch("/api/exam/state", { cache: "no-store" });
        const body = (await payload(response)) as StateBody | ApiErrorPayload | null;
        if (!response.ok) {
          const code = body && "error" in body ? body.error.code : "internal_error";
          if (sessionGeneration.current === generation) setError(code);
          throw new Error(code);
        }
        if (sessionGeneration.current === generation) {
          setError(null);
          setState(body as StateBody);
        }
        return body as StateBody;
      })();
      const settled = request.finally(() => {
        if (sessionGeneration.current === generation) {
          stateLoaded.current = true;
          setLoaded(true);
        }
        if (statePromise.current === settled) statePromise.current = null;
      });
      statePromise.current = settled;
    }
    return statePromise.current;
  }, []);

  const loadMe = useCallback(async () => {
    if (!mePromise.current) {
      mePromise.current = fetch("/api/auth/me", { cache: "no-store" })
        .then(async (response) => {
          const body = (await payload(response)) as CandidateMe | ApiErrorPayload | null;
          if (!response.ok) {
            const code = body && "error" in body ? body.error.code : "internal_error";
            setError(code);
            throw new Error(code);
          }
          setMe(body as CandidateMe);
          return body as CandidateMe;
        })
        .catch((loadError) => {
          mePromise.current = null;
          throw loadError;
        });
    }
    return mePromise.current;
  }, []);

  const loadPaper = useCallback(async (force = false) => {
    if (force) {
      paperPromise.current = null;
      setPaper(null);
    }
    if (paper && !force) return paper;
    if (!paperPromise.current) {
      const generation = sessionGeneration.current;
      paperPromise.current = fetch("/api/exam/paper", { cache: "no-store" })
        .then(async (response) => {
          const body = (await payload(response)) as PaperBody | ApiErrorPayload | null;
          if (!response.ok) {
            const code = body && "error" in body ? body.error.code : "internal_error";
            if (code === "unauthenticated" || code === "session_revoked") setError(code);
            throw new CandidatePaperError(code, response.status);
          }
          if (sessionGeneration.current === generation) setPaper(body as PaperBody);
          return body as PaperBody;
        })
        .catch((loadError) => {
          paperPromise.current = null;
          throw loadError;
        });
    }
    return paperPromise.current;
  }, [paper]);

  useEffect(() => {
    if (pathname === "/login") {
      const scheduledGeneration = sessionGeneration.current;
      const timer = window.setTimeout(() => {
        if (sessionGeneration.current === scheduledGeneration) {
          resetCandidateSession();
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (stateLoaded.current) return;
    void refreshState().catch(() => null);
  }, [pathname, refreshState, resetCandidateSession]);

  const visibleState = pathname === "/login" ? null : state;
  const visibleMe = pathname === "/login" ? null : me;
  const visiblePaper = pathname === "/login" ? null : paper;
  const visibleError = pathname === "/login" ? null : error;
  const decision = routeFor({
    state: visibleState,
    error: visibleError,
    pathname,
    checkPassed,
  });
  const terminalScreen = "screen" in decision ? decision.screen : null;
  useEffect(() => {
    if (terminalScreen === "ended" || terminalScreen === "signed_out" || terminalScreen === "please_sign_in") {
      void stopMedia();
      void releaseDeviceCheck();
    }
  }, [releaseDeviceCheck, stopMedia, terminalScreen]);
  useEffect(() => {
    if ("redirect" in decision && decision.redirect !== pathname) {
      router.replace(decision.redirect);
    }
  }, [decision, pathname, router]);

  useEffect(() => {
    if (pathname === "/exam") return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("h1")?.focus();
      const heading = document.querySelector("h1")?.textContent?.trim() || "Online exam";
      document.title = `${heading} · ${visibleState?.exam.title ?? "Cosmetics.lk"}`;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, visibleState?.exam.title]);

  const value = useMemo(
    () => ({
      state: visibleState,
      me: visibleMe,
      paper: visiblePaper,
      checkPassed,
      setCheckPassed,
      refreshState,
      heartbeatNow,
      loadMe,
      loadPaper,
      markExamHandoff,
      hasExamHandoff,
      resetCandidateSession,
    }),
    [
      visibleState,
      visibleMe,
      visiblePaper,
      checkPassed,
      refreshState,
      heartbeatNow,
      loadMe,
      loadPaper,
      markExamHandoff,
      hasExamHandoff,
      resetCandidateSession,
    ],
  );

  let content: ReactNode;
  if (pathname !== "/login" && !loaded) {
    content = <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  } else if ("screen" in decision) {
    const screenContent = {
      ended: ["This exam has ended.", "The exam is closed. You can sign out."],
      signed_out: ["You were signed out", "This account was opened on another device, or the exam team ended your session. Your saved answers are safe. Sign in again to continue, or ask the exam team for help."],
      please_sign_in: ["Please sign in again", "Your session has ended. Your saved answers are safe."],
    }[decision.screen];
    content = <CandidateErrorScreen title={screenContent[0]} body={screenContent[1]} signOut={decision.screen === "ended"} resetSession={resetCandidateSession} />;
  } else if ("redirect" in decision) {
    content = <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  } else {
    content = <CandidateContext.Provider value={value}>{children}</CandidateContext.Provider>;
  }
  return <><AnnouncementToast announcement={announcement} />{content}</>;
}

export function useCandidate(): CandidateContextValue {
  const value = useContext(CandidateContext);
  if (!value) throw new Error("useCandidate must be used inside CandidateProvider");
  return value;
}

export function CandidateFrame({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  const context = useContext(CandidateContext);
  useEffect(() => {
    if (context?.state && !context.me) context.loadMe().catch(() => null);
  }, [context]);
  return (
    <main className="candidate-page min-h-dvh w-full py-8">
      <div className={wide ? "mx-auto max-w-[68ch]" : "mx-auto max-w-md"}>
        <header className="mb-8">
          <Image src="/brand/logo-ink.png" alt="Cosmetics.lk" width={201} height={187} className="h-10 w-auto" priority />
          {context?.me ? <p className="mt-2 text-sm text-muted">{context.me.candidate.full_name} · {context.me.candidate.mer_code}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`border-l-4 p-4 ${warning ? "border-warn bg-warn-tint" : "border-ink bg-selected"}`} role={warning ? "alert" : "status"}>{children}</div>;
}

export function CandidateErrorScreen({
  title,
  body,
  signOut = false,
  resetSession,
}: {
  title: string;
  body: string;
  signOut?: boolean;
  resetSession?: () => void;
}) {
  const router = useRouter();
  const context = useContext(CandidateContext);
  async function leave() {
    if (signOut) {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }).catch(() => null);
    }
    (resetSession ?? context?.resetCandidateSession)?.();
    router.push("/login");
  }
  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">{title}</h1><p className="mt-4 text-muted">{body}</p><Button className="mt-6" onClick={leave}>{signOut ? "Sign out" : "Sign in"}</Button></CandidateFrame>;
}
