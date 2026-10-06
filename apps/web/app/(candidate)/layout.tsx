import type { ReactNode } from "react";
import { CandidateProvider } from "@/components/candidate/CandidateContext";
import { CandidateLiveKitProvider } from "@/components/candidate/LiveKitContext";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateProvider><CandidateLiveKitProvider>{children}</CandidateLiveKitProvider></CandidateProvider>;
}
