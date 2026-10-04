// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ state: null as unknown, clearAttempt: vi.fn() }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ state: mocks.state }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/indexeddb", () => ({ getAnswerDraftStore: () => ({ clearAttempt: mocks.clearAttempt }) }));

import DonePage from "./page";

beforeEach(() => {
  mocks.clearAttempt.mockReset().mockResolvedValue(undefined);
  mocks.state = {
    exam: { title: "Synthetic Exam" },
    attempt: { id: "attempt-1", submit_reason: "manual" },
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("DonePage", () => {
  it.each([
    ["manual", "Thank you. Your answers were received."],
    ["auto", "Time ran out, so your exam was submitted automatically. Answers that reached the server before then were kept."],
    ["forced", "The exam team ended the exam. Answers saved before then were submitted."],
  ])("shows the %s reason without scores and logs out once", async (reason, copy) => {
    mocks.state = { exam: { title: "Synthetic Exam" }, attempt: { id: "attempt-1", submit_reason: reason } };
    render(<DonePage />);
    expect(screen.getByRole("heading", { name: "Your exam is submitted" })).toBeTruthy();
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByText(/mark|score|result/i)).toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(mocks.clearAttempt).toHaveBeenCalledWith("attempt-1");
  });
});
