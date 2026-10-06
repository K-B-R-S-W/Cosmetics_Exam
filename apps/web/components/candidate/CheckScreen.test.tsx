// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), setCheckPassed: vi.fn(), acquire: vi.fn(), status: "idle" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ state: { phase: "waiting" }, setCheckPassed: mocks.setCheckPassed }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/candidate/LiveKitContext", () => ({
  useCandidateLiveKit: () => ({ status: mocks.status, acquireAndConnect: mocks.acquire }),
}));

import { CheckScreen } from "./CheckScreen";

beforeEach(() => {
  mocks.push.mockReset(); mocks.setCheckPassed.mockReset(); mocks.acquire.mockReset().mockResolvedValue(true); mocks.status = "idle";
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
    expect(mocks.setCheckPassed).toHaveBeenCalledWith(true);
    expect(mocks.push).toHaveBeenCalledWith("/waiting");
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
});
