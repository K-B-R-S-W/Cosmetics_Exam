// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), setCheckPassed: vi.fn(), markExamHandoff: vi.fn(), acquire: vi.fn(), status: "idle", phase: "waiting" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ state: { phase: mocks.phase }, setCheckPassed: mocks.setCheckPassed, markExamHandoff: mocks.markExamHandoff }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/candidate/LiveKitContext", () => ({
  useCandidateLiveKit: () => ({ status: mocks.status, acquireAndConnect: mocks.acquire }),
}));

import { CheckScreen } from "./CheckScreen";

beforeEach(() => {
  mocks.push.mockReset(); mocks.setCheckPassed.mockReset(); mocks.markExamHandoff.mockReset(); mocks.acquire.mockReset().mockResolvedValue(true); mocks.status = "idle"; mocks.phase = "waiting";
});
afterEach(cleanup);

describe("CheckScreen", () => {
  it("uses the provider permission action and keeps Continue disabled until connected", async () => {
    const view = render(<CheckScreen />);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
    await waitFor(() => expect(mocks.acquire).toHaveBeenCalledTimes(1));
    mocks.status = "connected";
    view.rerender(<CheckScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(mocks.markExamHandoff).toHaveBeenCalledTimes(1);
    expect(mocks.setCheckPassed).toHaveBeenCalledWith(true);
    expect(mocks.push).toHaveBeenCalledWith("/waiting");
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.setCheckPassed.mock.invocationCallOrder[0]!);
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
  });

  it("does not block continuing after a provider failure", async () => {
    mocks.acquire.mockResolvedValue(false);
    render(<CheckScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
    await waitFor(() => expect(screen.getByText(/Your exam can continue/)).toBeTruthy());
    const continueButton = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(mocks.push).toHaveBeenCalledWith("/waiting");
  });

  it("marks a live Check to Exam handoff before the transient redirect", () => {
    mocks.phase = "live";
    mocks.status = "connected";
    render(<CheckScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(mocks.markExamHandoff).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/exam");
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.setCheckPassed.mock.invocationCallOrder[0]!);
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
  });
});
