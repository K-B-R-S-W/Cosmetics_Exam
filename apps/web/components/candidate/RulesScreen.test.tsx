// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesScreen } from "./RulesScreen";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), loadMe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push }) }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ loadMe: mocks.loadMe }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  CandidateErrorScreen: () => <div>Error</div>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => { mocks.replace.mockReset(); mocks.push.mockReset(); mocks.loadMe.mockReset(); sessionStorage.clear(); });
afterEach(cleanup);

describe("RulesScreen", () => {
  it("redirects before loading or sending when confirmation is absent", async () => {
    render(<RulesScreen />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/confirm"));
    expect(mocks.loadMe).not.toHaveBeenCalled();
  });

  it("renders the retention value returned by the API", async () => {
    sessionStorage.setItem("identityConfirmed", "1");
    mocks.loadMe.mockResolvedValue({
      candidate: { mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training" },
      exam: { id: "e", title: "Synthetic exam", instructions: null, scheduled_start_at: null, duration_min: 45, navigation_mode: "free", question_count: 20, status: "scheduled" },
      attempt: { id: "a", status: "not_started" },
      rules: { snapshot_retention_days: 14 },
    });
    render(<RulesScreen />);
    expect(await screen.findByText(/deleted after 14 days/)).toBeTruthy();
  });
});
