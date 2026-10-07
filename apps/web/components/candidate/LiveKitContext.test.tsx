// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/check", hook: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/hooks/useLiveKit", () => ({ useLiveKit: () => mocks.hook }));

import { CandidateLiveKitProvider, useCandidateLiveKit } from "./LiveKitContext";

const stream = {} as MediaStream;

function hookValue(overrides: Record<string, unknown> = {}) {
  return {
    status: "connected",
    stream,
    mediaTracks: [],
    cameraLost: false,
    microphoneLost: false,
    connectionLost: false,
    acquireAndConnect: vi.fn().mockResolvedValue(true),
    trySilentReacquire: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function MediaControls() {
  const media = useCandidateLiveKit();
  return <><button onClick={() => void media.acquireAndConnect()}>Acquire</button><button onClick={() => void media.stop()}>Stop</button></>;
}

beforeEach(() => {
  mocks.pathname = "/check";
  mocks.hook = hookValue();
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(cleanup);

describe("CandidateLiveKitProvider", () => {
  it("keeps one preview and connection across check, waiting and exam, then does not reconnect on Done", () => {
    const view = render(<CandidateLiveKitProvider><p>Candidate child</p></CandidateLiveKitProvider>);
    const original = screen.getByLabelText("Your camera preview");
    mocks.pathname = "/waiting";
    view.rerender(<CandidateLiveKitProvider><p>Candidate child</p></CandidateLiveKitProvider>);
    expect(screen.getByLabelText("Your camera preview")).toBe(original);
    mocks.pathname = "/exam";
    view.rerender(<CandidateLiveKitProvider><p>Candidate child</p></CandidateLiveKitProvider>);
    expect(screen.getByLabelText("Your camera preview")).toBe(original);
    mocks.pathname = "/done";
    view.rerender(<CandidateLiveKitProvider><p>Candidate child</p></CandidateLiveKitProvider>);
    expect(screen.queryByLabelText("Your camera preview")).toBeNull();
    expect(mocks.hook.trySilentReacquire).not.toHaveBeenCalled();
    expect(mocks.hook.stop).not.toHaveBeenCalled();
  });

  it("asks the hook for silent reload recovery without blocking its children", () => {
    mocks.pathname = "/exam";
    mocks.hook = hookValue({ stream: null, status: "failed", trySilentReacquire: vi.fn().mockResolvedValue(false) });
    render(<CandidateLiveKitProvider><p>Exam remains usable</p></CandidateLiveKitProvider>);
    expect(screen.getByText("Exam remains usable")).toBeTruthy();
    expect(mocks.hook.trySilentReacquire).toHaveBeenCalledTimes(1);
  });

  it("suppresses silent reacquire after a terminal stop until an explicit acquire", () => {
    mocks.pathname = "/exam";
    mocks.hook = hookValue({ stream: null });
    const view = render(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    expect(mocks.hook.trySilentReacquire).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mocks.hook.stop).toHaveBeenCalledTimes(1);
    mocks.pathname = "/waiting";
    view.rerender(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    expect(mocks.hook.trySilentReacquire).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Acquire" }));
    mocks.pathname = "/exam";
    view.rerender(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    expect(mocks.hook.acquireAndConnect).toHaveBeenCalledTimes(1);
    expect(mocks.hook.trySilentReacquire).toHaveBeenCalledTimes(2);
  });

  it("clears terminal suppression on login", () => {
    mocks.pathname = "/exam";
    mocks.hook = hookValue({ stream: null });
    const view = render(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    mocks.pathname = "/login";
    view.rerender(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    mocks.pathname = "/waiting";
    view.rerender(<CandidateLiveKitProvider><MediaControls /></CandidateLiveKitProvider>);
    expect(mocks.hook.trySilentReacquire).toHaveBeenCalledTimes(2);
  });

  it("remains Strict Mode safe on a waiting-room reload", () => {
    mocks.pathname = "/waiting";
    const oneFlight = vi.fn().mockResolvedValue(true);
    mocks.hook = hookValue({ stream: null, trySilentReacquire: oneFlight });
    render(<StrictMode><CandidateLiveKitProvider><p>Waiting</p></CandidateLiveKitProvider></StrictMode>);
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(oneFlight).toHaveBeenCalled();
  });
});
