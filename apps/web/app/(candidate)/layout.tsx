import type { ReactNode } from "react";
import { CandidateProvider } from "@/components/candidate/CandidateContext";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateProvider>{children}</CandidateProvider>;
}
