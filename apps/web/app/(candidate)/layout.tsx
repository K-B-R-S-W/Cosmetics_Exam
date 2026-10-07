import type { ReactNode } from "react";
import { CandidateProvider } from "@/components/candidate/CandidateContext";
import { DeviceCheckProvider } from "@/components/candidate/DeviceCheckContext";
import { CandidateLiveKitProvider } from "@/components/candidate/LiveKitContext";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateLiveKitProvider><DeviceCheckProvider><CandidateProvider>{children}</CandidateProvider></DeviceCheckProvider></CandidateLiveKitProvider>;
}
