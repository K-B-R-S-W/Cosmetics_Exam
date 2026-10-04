// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesScreen } from "./RulesScreen";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), loadMe: vi.fn(), refreshState: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push }) }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ loadMe: mocks.loadMe, refreshState: mocks.refreshState }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  CandidateErrorScreen: () => <div>Error</div>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => { mocks.replace.mockReset(); mocks.push.mockReset(); mocks.loadMe.mockReset(); mocks.refreshState.mockReset().mockResolvedValue(null); sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("refreshes state before shortcutting an acknowledged candidate", async () => {
    sessionStorage.setItem("identityConfirmed", "1");
    mocks.loadMe.mockResolvedValue({
      candidate: { mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training" },
      exam: { id: "e", title: "Synthetic exam", instructions: null, scheduled_start_at: null, duration_min: 45, navigation_mode: "free", question_count: 20, status: "scheduled" },
      attempt: { id: "a", status: "acknowledged" },
      rules: { snapshot_retention_days: 14 },
    });
    render(<RulesScreen />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/check"));
    expect(mocks.refreshState).toHaveBeenCalledTimes(1);
    expect(mocks.refreshState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0]!,
    );
  });

  it("refreshes state before navigating on already_submitted", async () => {
    sessionStorage.setItem("identityConfirmed", "1");
    mocks.loadMe.mockResolvedValue({
      candidate: { mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training" },
      exam: { id: "e", title: "Synthetic exam", instructions: null, scheduled_start_at: null, duration_min: 45, navigation_mode: "free", question_count: 20, status: "scheduled" },
      attempt: { id: "a", status: "not_started" },
      rules: { snapshot_retention_days: 14 },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "already_submitted", message: "Submitted", details: null } }), { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesScreen />);
    fireEvent.click(await screen.findByLabelText("I have read and accept these rules."));
    fireEvent.click(screen.getByRole("button", { name: "Accept and continue" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/done"));
    expect(mocks.refreshState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0]!,
    );
  });
});
