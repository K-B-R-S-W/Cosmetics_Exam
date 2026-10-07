// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(), setCheckPassed: vi.fn(), markExamHandoff: vi.fn(), refreshState: vi.fn(),
  acquire: vi.fn(), requestWakeLock: vi.fn(), status: "idle", phase: "waiting",
  tracks: [] as Array<{ kind: "audio" | "video"; source: "track"; track: MediaStreamTrack }>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ state: { phase: mocks.phase, attempt: { deadline: null } }, setCheckPassed: mocks.setCheckPassed, markExamHandoff: mocks.markExamHandoff, refreshState: mocks.refreshState }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/candidate/LiveKitContext", () => ({ useCandidateLiveKit: () => ({ status: mocks.status, mediaTracks: mocks.tracks, acquireAndConnect: mocks.acquire }) }));
vi.mock("@/components/candidate/DeviceCheckContext", () => ({ useDeviceCheck: () => ({ requestWakeLock: mocks.requestWakeLock }) }));
vi.mock("@/lib/time", async (original) => ({ ...(await original<typeof import("@/lib/time")>()), syncServerClock: vi.fn().mockResolvedValue(0), useServerClock: () => () => 0 }));

import { CheckScreen } from "./CheckScreen";

const liveTrack = (kind: "audio" | "video") => ({ kind, source: "track" as const, track: { readyState: "live", muted: false } as MediaStreamTrack });
let fullscreenElement: Element | null;

beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: vi.fn(async () => { fullscreenElement = document.documentElement; document.dispatchEvent(new Event("fullscreenchange")); }) });
  Object.defineProperty(window.screen, "orientation", { configurable: true, value: { type: "landscape-primary", lock: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  mocks.push.mockReset(); mocks.setCheckPassed.mockReset(); mocks.markExamHandoff.mockReset(); mocks.refreshState.mockReset().mockResolvedValue(null); mocks.requestWakeLock.mockReset().mockResolvedValue(true); mocks.acquire.mockReset().mockResolvedValue(true); mocks.status = "idle"; mocks.phase = "waiting"; mocks.tracks = [];
});
afterEach(cleanup);

async function passCheck(view: ReturnType<typeof render>) {
  fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
  await waitFor(() => expect(mocks.acquire).toHaveBeenCalledOnce());
  mocks.status = "connected"; mocks.tracks = [liveTrack("video"), liveTrack("audio")];
  view.rerender(<CheckScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  await waitFor(() => expect(mocks.refreshState).toHaveBeenCalledOnce());
}

describe("CheckScreen", () => {
  it("keeps Continue blocked when camera or microphone setup fails", async () => {
    mocks.acquire.mockResolvedValue(false);
    render(<CheckScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
    await waitFor(() => expect(screen.getByText(/Camera or microphone access is blocked/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("runs prompts in order and preserves the exam handoff order", async () => {
    const view = render(<CheckScreen />);
    expect((screen.getByRole("button", { name: "Enter fullscreen" }) as HTMLButtonElement).disabled).toBe(true);
    await passCheck(view);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(mocks.requestWakeLock).toHaveBeenCalledOnce();
    expect(mocks.markExamHandoff).toHaveBeenCalledOnce();
    expect(mocks.setCheckPassed).toHaveBeenCalledWith(true);
    expect(mocks.push).toHaveBeenCalledWith("/waiting");
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.setCheckPassed.mock.invocationCallOrder[0]!);
    expect(mocks.markExamHandoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
  });

  it("rechecks fullscreen when Continue is pressed", async () => {
    const view = render(<CheckScreen />);
    await passCheck(view);
    fullscreenElement = null;
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText(/Fullscreen didn't start/)).toBeTruthy();
  });

  it("routes a live attempt to the exam and shows its timer", async () => {
    mocks.phase = "live";
    const view = render(<CheckScreen />);
    await passCheck(view);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/exam is running/)).toBeTruthy();
    expect(mocks.push).toHaveBeenCalledWith("/exam");
  });

  it("blocks Android desktop-site mode after fullscreen", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36" });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    const view = render(<CheckScreen />);
    await passCheck(view);
    expect(screen.getByText(/Turn off "Desktop site"/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns about a second screen without blocking Continue", async () => {
    Object.defineProperty(window.screen, "isExtended", { configurable: true, value: true });
    const view = render(<CheckScreen />);
    await passCheck(view);
    expect(screen.getByText(/A second screen was found/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
