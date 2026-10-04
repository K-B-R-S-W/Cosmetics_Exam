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
import { routeFor } from "@/lib/candidate-routing";
import type { ApiErrorPayload, CandidateMe, StateBody } from "@/lib/candidate-types";

interface CandidateContextValue {
  state: StateBody | null;
  me: CandidateMe | null;
  checkPassed: boolean;
  setCheckPassed(value: boolean): void;
  refreshState(): Promise<StateBody | null>;
  loadMe(): Promise<CandidateMe>;
}

const CandidateContext = createContext<CandidateContextValue | null>(null);

async function payload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function CandidateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<StateBody | null>(null);
  const [me, setMe] = useState<CandidateMe | null>(null);
  const [checkPassed, setCheckPassed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(pathname === "/login");
  const mePromise = useRef<Promise<CandidateMe> | null>(null);
  const stateLoaded = useRef(false);

  const refreshState = useCallback(async () => {
    const response = await fetch("/api/exam/state", { cache: "no-store" });
    const body = (await payload(response)) as StateBody | ApiErrorPayload | null;
    if (!response.ok) {
      const code = body && "error" in body ? body.error.code : "internal_error";
      setError(code);
      throw new Error(code);
    }
    setError(null);
    setState(body as StateBody);
    return body as StateBody;
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

  useEffect(() => {
    if (pathname === "/login") {
      return;
    }
    if (stateLoaded.current) return;
    stateLoaded.current = true;
    let active = true;
    refreshState()
      .catch(() => null)
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [pathname, refreshState]);

  const decision = routeFor({ state, error, pathname, checkPassed });
  useEffect(() => {
    if ("redirect" in decision && decision.redirect !== pathname) {
      router.replace(decision.redirect);
    }
  }, [decision, pathname, router]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("h1")?.focus();
      const heading = document.querySelector("h1")?.textContent?.trim() || "Online exam";
      document.title = `${heading} · ${state?.exam.title ?? "Cosmetics.lk"}`;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, state?.exam.title]);

  const value = useMemo(
    () => ({ state, me, checkPassed, setCheckPassed, refreshState, loadMe }),
    [state, me, checkPassed, refreshState, loadMe],
  );

  if (pathname !== "/login" && !loaded) {
    return <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  }
  if ("screen" in decision) {
    const content = {
      ended: ["This exam has ended.", "The exam is closed. You can sign out."],
      signed_out: ["You were signed out", "This account was opened on another device, or the exam team ended your session. Your saved answers are safe. Sign in again to continue, or ask the exam team for help."],
      please_sign_in: ["Please sign in again", "Your session has ended. Your saved answers are safe."],
    }[decision.screen];
    return <CandidateErrorScreen title={content[0]} body={content[1]} signOut={decision.screen === "ended"} />;
  }
  if ("redirect" in decision) {
    return <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  }
  return <CandidateContext.Provider value={value}>{children}</CandidateContext.Provider>;
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

export function CandidateErrorScreen({ title, body, signOut = false }: { title: string; body: string; signOut?: boolean }) {
  const router = useRouter();
  async function leave() {
    if (signOut) {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }).catch(() => null);
    }
    router.push("/login");
  }
  return <CandidateFrame><h1 tabIndex={-1} className="text-title font-bold">{title}</h1><p className="mt-4 text-muted">{body}</p><Button className="mt-6" onClick={leave}>{signOut ? "Sign out" : "Sign in"}</Button></CandidateFrame>;
}
