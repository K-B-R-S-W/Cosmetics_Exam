// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateProvider, useCandidate } from "./CandidateContext";
import { useCandidateLiveKit } from "./LiveKitContext";
import { useDeviceCheck } from "./DeviceCheckContext";
import { CheckScreen } from "./CheckScreen";
import { ConfirmScreen } from "./ConfirmScreen";
import { LoginForm } from "./LoginForm";
import { RulesScreen } from "./RulesScreen";
import CandidateLayout from "@/app/(candidate)/layout";

const navigation = vi.hoisted(() => ({
  path: "/login",
  push: vi.fn<(path: string) => void>(),
  replace: vi.fn<(path: string) => void>(),
}));

const liveKit = vi.hoisted(() => {
  class Room {
    state = "disconnected";
    connect = vi.fn(async () => { this.state = "connected"; });
    disconnect = vi.fn(async () => { this.state = "disconnected"; });
    localParticipant = {
      trackPublications: new Map<number, { track: FakeLocalTrack }>(),
      publishTrack: vi.fn(async (track: FakeLocalTrack) => {
        this.localParticipant.trackPublications.set(this.localParticipant.trackPublications.size, { track });
      }),
      unpublishTrack: vi.fn(async () => undefined),
    };
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    constructor() { liveKit.rooms.push(this); }
    on(event: string, handler: (...args: unknown[]) => void) { const handlers = this.handlers.get(event) ?? new Set(); handlers.add(handler); this.handlers.set(event, handlers); }
    off(event: string, handler: (...args: unknown[]) => void) { this.handlers.get(event)?.delete(handler); }
  }
  return { createLocalTracks: vi.fn(), rooms: [] as Room[], Room };
});

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => navigation,
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("livekit-client", () => ({
  ConnectionState: { Disconnected: "disconnected", Connected: "connected" },
  RoomEvent: { Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected" },
  Track: { Kind: { Video: "video", Audio: "audio" }, Source: { Camera: "camera", Microphone: "microphone" } },
  Room: liveKit.Room,
  createLocalTracks: liveKit.createLocalTracks,
}));

class FakeMediaTrack extends EventTarget {
  kind: "audio" | "video";
  muted = false;
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  constructor(kind: "audio" | "video") { super(); this.kind = kind; }
}

class FakeLocalTrack {
  kind: "audio" | "video";
  mediaStreamTrack: FakeMediaTrack;
  stop = vi.fn(() => this.mediaStreamTrack.stop());
  constructor(kind: "audio" | "video") { this.kind = kind; this.mediaStreamTrack = new FakeMediaTrack(kind); }
}

class FakeMediaStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}
  getTracks() { return this.tracks; }
}

type CandidateKey = "A" | "B";
let activeCandidate: CandidateKey | null;
let attemptStatus: "not_started" | "acknowledged";
let candidatePhase: "waiting" | "live";
let candidateControls: ReturnType<typeof useCandidate> | null;
const fetchMock = vi.fn();
let fullscreenElement: Element | null;
let wakeLockRelease: ReturnType<typeof vi.fn>;

const people = {
  A: { name: "Candidate A", mer: "TEST-A", exam: "Exam A" },
  B: { name: "Candidate B", mer: "TEST-B", exam: "Exam B" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stateBody(key: CandidateKey) {
  return {
    server_time: "2026-10-04T10:00:00.000Z",
    phase: candidatePhase,
    exam: {
      id: `exam-${key}`,
      title: people[key].exam,
      status: candidatePhase === "live" ? "live" : "scheduled",
      navigation_mode: "free",
      scheduled_start_at: null,
      started_at: null,
      ends_at: null,
      force_ended: false,
      question_count: 20,
    },
    attempt: {
      id: `attempt-${key}`,
      status: attemptStatus,
      current_position: 0,
      extra_minutes: 0,
      deadline: null,
      submit_reason: null,
    },
    announcements: [],
  };
}

function meBody(key: CandidateKey) {
  return {
    candidate: {
      mer_code: people[key].mer,
      full_name: people[key].name,
      outlet: "Training",
    },
    exam: {
      id: `exam-${key}`,
      title: people[key].exam,
      instructions: null,
      scheduled_start_at: null,
      duration_min: 45,
      navigation_mode: "free",
      question_count: 20,
      status: "scheduled",
    },
    attempt: { id: `attempt-${key}`, status: attemptStatus },
    rules: { snapshot_retention_days: 14 },
  };
}

function CurrentPage() {
  if (navigation.path === "/login") return <LoginForm />;
  if (navigation.path === "/confirm") return <ConfirmScreen />;
  if (navigation.path === "/rules") return <RulesScreen />;
  if (navigation.path === "/check") return <CheckScreen />;
  if (navigation.path === "/waiting" || navigation.path === "/exam") return <StateRefreshProbe />;
  return null;
}

function App() {
  return <CandidateProvider><CurrentPage /></CandidateProvider>;
}

function LayoutApp() {
  return <CandidateLayout><CurrentPage /></CandidateLayout>;
}

function PaperProbe() {
  const { loadPaper } = useCandidate();
  return <><button onClick={() => void loadPaper()}>Load paper one</button><button onClick={() => void loadPaper()}>Load paper two</button></>;
}

function HeartbeatProbe() {
  const { heartbeatNow } = useCandidate();
  return <button onClick={() => void heartbeatNow().catch(() => null)}>Heartbeat now</button>;
}

function StateRefreshProbe() {
  const { refreshState } = useCandidate();
  return <button onClick={() => void refreshState()}>Refresh state</button>;
}

function SessionControls() {
  const candidate = useCandidate();
  useEffect(() => {
    candidateControls = candidate;
    return () => { if (candidateControls === candidate) candidateControls = null; };
  }, [candidate]);
  const media = useCandidateLiveKit();
  const device = useDeviceCheck();
  return <>
    <button onClick={() => void media.acquireAndConnect()}>Connect media</button>
    <button onClick={() => void device.requestWakeLock()}>Acquire wake lock</button>
    <button onClick={() => candidate.resetCandidateSession()}>Reset session</button>
    <button onClick={() => void candidate.refreshState().catch(() => null)}>Refresh session</button>
  </>;
}

function enterLogin(key: CandidateKey) {
  fireEvent.change(screen.getByLabelText("MER code"), {
    target: { value: people[key].mer },
  });
  fireEvent.change(screen.getByLabelText("ID number"), {
    target: { value: key === "A" ? "200012345678" : "200112345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

async function rerenderAt(view: ReturnType<typeof render>, path: string) {
  navigation.path = path;
  view.rerender(<App />);
  await Promise.resolve();
}

beforeEach(() => {
  fullscreenElement = null;
  wakeLockRelease = vi.fn().mockResolvedValue(undefined);
  liveKit.rooms.length = 0;
  liveKit.createLocalTracks.mockReset().mockResolvedValue([new FakeLocalTrack("video"), new FakeLocalTrack("audio")]);
  activeCandidate = null;
  attemptStatus = "not_started";
  candidatePhase = "waiting";
  candidateControls = null;
  navigation.path = "/login";
  navigation.push.mockReset().mockImplementation((path) => {
    navigation.path = path.split("?", 1)[0]!;
  });
  navigation.replace.mockReset().mockImplementation((path) => {
    navigation.path = path.split("?", 1)[0]!;
  });
  sessionStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("MediaStream", FakeMediaStream);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: vi.fn().mockResolvedValue({ released: false, release: wakeLockRelease }) } });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: vi.fn(async () => { fullscreenElement = document.documentElement; document.dispatchEvent(new Event("fullscreenchange")); }) });
  Object.defineProperty(window.screen, "orientation", { configurable: true, value: { type: "landscape-primary", lock: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  fetchMock.mockReset().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/login") {
      const body = JSON.parse(String(init?.body)) as { mer_code: string };
      activeCandidate = body.mer_code === people.A.mer ? "A" : "B";
      attemptStatus = "not_started";
      return json({ next: "confirm" });
    }
    if (url === "/api/exam/state") return json(stateBody(activeCandidate!));
    if (url === "/api/auth/me") return json(meBody(activeCandidate!));
    if (url === "/api/exam/paper") return json({ server_time: "2026-10-04T10:00:00.000Z", navigation_mode: "free", total_questions: 0, current_position: null, questions: [], answers: {} });
    if (url === "/api/auth/acknowledge") {
      attemptStatus = "acknowledged";
      return json({ attempt: { status: attemptStatus } });
    }
    if (url === "/api/auth/logout") {
      activeCandidate = null;
      return json({ ok: true });
    }
    if (url === "/api/livekit/token") {
      return json({ token: "token", url: "ws://localhost:7880", room: "exam-A", identity: "candidate-A" });
    }
    if (url === "/api/time") return json({ server_time_ms: Date.now() });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateProvider flow state", () => {
  it("keeps one LiveKit token and room through the transient check redirect, waiting and exam", async () => {
    activeCandidate = "A";
    attemptStatus = "acknowledged";
    navigation.path = "/check";
    navigation.push.mockImplementation(() => undefined);
    const view = render(<LayoutApp />);
    await screen.findByRole("heading", { name: "Check your setup" });

    fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
    await screen.findByText("Camera preview and microphone are ready.");
    const room = liveKit.rooms[0]!;
    const tracks = [...room.localParticipant.trackPublications.values()].map(({ track }) => track);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/waiting"));
    expect(wakeLockRelease).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(tracks.every((track) => track.mediaStreamTrack.readyState === "live")).toBe(true);

    navigation.path = "/waiting";
    view.rerender(<LayoutApp />);
    candidatePhase = "live";
    fireEvent.click(await screen.findByRole("button", { name: "Refresh state" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/exam/state")).toHaveLength(3));
    navigation.path = "/exam";
    view.rerender(<LayoutApp />);

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect({
      tokenRequests: fetchMock.mock.calls.filter(([url]) => String(url) === "/api/livekit/token").length,
      roomConnections: liveKit.rooms.reduce((count, room) => count + room.connect.mock.calls.length, 0),
    }).toEqual({ tokenRequests: 1, roomConnections: 1 });
  });

  it("clears a terminal stop when a new login reaches Check and explicitly acquires media", async () => {
    navigation.path = "/login";
    const view = render(<LayoutApp />);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    activeCandidate = "A";
    attemptStatus = "acknowledged";
    navigation.path = "/check";
    view.rerender(<LayoutApp />);
    await screen.findByRole("heading", { name: "Check your setup" });
    fireEvent.click(screen.getByRole("button", { name: "Allow camera and mic" }));
    await screen.findByText("Camera preview and microphone are ready.");

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/livekit/token")).toHaveLength(1);
    expect(liveKit.rooms).toHaveLength(1);
    expect(liveKit.rooms[0]!.connect).toHaveBeenCalledTimes(1);
  });

  it("resetCandidateSession stops media without silently reacquiring on Waiting", async () => {
    activeCandidate = "A";
    attemptStatus = "acknowledged";
    navigation.path = "/waiting";
    render(<CandidateLayout><SessionControls /></CandidateLayout>);
    await screen.findByRole("button", { name: "Connect media" });
    await waitFor(() => expect(liveKit.rooms).toHaveLength(1));
    const room = liveKit.rooms[0]!;
    await waitFor(() => expect(room.connect).toHaveBeenCalledTimes(1));
    const tracks = [...room.localParticipant.trackPublications.values()].map(({ track }) => track);

    fireEvent.click(screen.getByRole("button", { name: "Acquire wake lock" }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Reset session" }));
    await waitFor(() => expect(room.disconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(wakeLockRelease).toHaveBeenCalledOnce());
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/livekit/token")).toHaveLength(1);
  });

  it("clears the in-memory exam handoff marker when the candidate session resets", async () => {
    activeCandidate = "A";
    attemptStatus = "acknowledged";
    navigation.path = "/waiting";
    render(<CandidateLayout><SessionControls /></CandidateLayout>);
    await screen.findByRole("button", { name: "Reset session" });
    act(() => candidateControls?.markExamHandoff());
    expect(candidateControls?.hasExamHandoff()).toBe(true);
    const controls = candidateControls;
    act(() => controls?.resetCandidateSession());
    expect(controls?.hasExamHandoff()).toBe(false);
  });

  it.each([
    ["ended", 200, "This exam has ended."],
    ["session_revoked", 401, "You were signed out"],
    ["unauthenticated", 401, "Please sign in again"],
  ])("terminal screen %s stops media and does not reconnect on Exam", async (code, status, heading) => {
    activeCandidate = "A";
    attemptStatus = "acknowledged";
    navigation.path = "/exam";
    let stateRequests = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/livekit/token") return json({ token: "token", url: "ws://localhost:7880", room: "exam-A", identity: "candidate-A" });
      if (url === "/api/exam/state") {
        stateRequests += 1;
        const base = stateBody("A");
        if (stateRequests === 1) return json({ ...base, phase: "live", exam: { ...base.exam, status: "live" }, attempt: { ...base.attempt, status: "in_progress" } });
        if (code === "ended") return json({ ...base, phase: "closed", exam: { ...base.exam, status: "ended" } });
        return json({ error: { code, message: "Synthetic terminal state" } }, status);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<CandidateLayout><SessionControls /></CandidateLayout>);
    await screen.findByRole("button", { name: "Connect media" });
    await waitFor(() => expect(liveKit.rooms).toHaveLength(1));
    const room = liveKit.rooms[0]!;
    await waitFor(() => expect(room.connect).toHaveBeenCalledTimes(1));
    const tracks = [...room.localParticipant.trackPublications.values()].map(({ track }) => track);

    fireEvent.click(screen.getByRole("button", { name: "Acquire wake lock" }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Refresh session" }));
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    await waitFor(() => expect(room.disconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(wakeLockRelease).toHaveBeenCalledOnce());
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/livekit/token")).toHaveLength(1);
  });

  it.each([
    ["unauthenticated", "Please sign in again"],
    ["session_revoked", "You were signed out"],
  ])("renders the %s screen after a Strict Mode state failure", async (code, heading) => {
    navigation.path = "/done";
    fetchMock.mockResolvedValue(json({ error: { code, message: "Synthetic auth failure" } }, 401));

    render(<StrictMode><CandidateProvider><div>Done page</div></CandidateProvider></StrictMode>);

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("refreshes acknowledged state before navigating and stays on check", async () => {
    const view = render(<App />);
    enterLogin("A");
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/confirm"));
    await rerenderAt(view, "/confirm");
    expect(await screen.findByText("Candidate A")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, this is me" }));
    await rerenderAt(view, "/rules");
    fireEvent.click(await screen.findByLabelText("I have read and accept these rules."));
    navigation.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Accept and continue" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/check"));
    await rerenderAt(view, "/check");

    expect(screen.getByRole("heading", { name: "Check your setup" })).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalledWith("/confirm");
  });

  it("clears candidate A before candidate B logs in in the same provider", async () => {
    const view = render(<App />);
    enterLogin("A");
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/confirm"));
    await rerenderAt(view, "/confirm");
    expect(await screen.findByText("Candidate A")).toBeTruthy();

    sessionStorage.setItem("identityConfirmed", "1");
    fireEvent.click(screen.getByRole("button", { name: "No, it isn't" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/login?signed_out=1"));
    expect(sessionStorage.getItem("identityConfirmed")).toBeNull();
    await rerenderAt(view, "/login");

    navigation.push.mockClear();
    enterLogin("B");
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/confirm"));
    expect(sessionStorage.getItem("identityConfirmed")).toBeNull();
    await rerenderAt(view, "/confirm");
    expect(await screen.findByText("Candidate B")).toBeTruthy();
    expect(screen.queryByText("Candidate A")).toBeNull();
    expect(screen.getByText("Exam B")).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/auth/me"),
    ).toHaveLength(2);

    navigation.replace.mockClear();
    await rerenderAt(view, "/rules");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/confirm"));
  });

  it("keeps concurrent paper requests one-flight", async () => {
    activeCandidate = "A";
    navigation.path = "/confirm";
    render(<CandidateProvider><PaperProbe /></CandidateProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/exam/state", { cache: "no-store" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load paper one" }));
    fireEvent.click(screen.getByRole("button", { name: "Load paper two" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/exam/paper")).toHaveLength(1));
  });

  it("calls the state endpoint as a bodyless GET", async () => {
    activeCandidate = "A";
    navigation.path = "/confirm";
    render(<CandidateProvider><PaperProbe /></CandidateProvider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/exam/state")).toBe(true));

    const stateCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/exam/state");
    expect(stateCall?.[1]).toEqual({ cache: "no-store" });
    expect(stateCall?.[1]).not.toHaveProperty("body");
    expect(stateCall?.[1]).not.toHaveProperty("method");
  });

  it("does not overwrite the tab title while the exam screen owns it", async () => {
    activeCandidate = "A";
    navigation.path = "/exam";
    document.title = "Question 7 · Exam A";
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/exam/state") {
        const base = stateBody("A");
        return json({
          ...base,
          phase: "live",
          exam: { ...base.exam, status: "live", ends_at: "2026-10-04T11:00:00.000Z" },
          attempt: { ...base.attempt, status: "in_progress", deadline: "2026-10-04T11:00:00.000Z" },
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    render(<CandidateProvider><h1>Provider must ignore this heading</h1></CandidateProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/exam/state", { cache: "no-store" }));
    expect(document.title).toBe("Question 7 · Exam A");
  });

  it.each([
    ["unauthenticated", "Please sign in again"],
    ["session_revoked", "You were signed out"],
  ])("renders the %s screen after a heartbeat 401 in Strict Mode", async (code, heading) => {
    activeCandidate = "A";
    navigation.path = "/exam";
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/exam/state") {
        const base = stateBody("A");
        return json({ ...base, phase: "live", exam: { ...base.exam, status: "live", ends_at: "2026-10-05T12:00:00.000Z" }, attempt: { ...base.attempt, status: "in_progress", deadline: "2026-10-05T12:00:00.000Z" } });
      }
      if (url === "/api/heartbeat") return json({ error: { code, message: "Synthetic auth failure" } }, 401);
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<StrictMode><CandidateProvider><HeartbeatProbe /></CandidateProvider></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Heartbeat now" }));
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByText("Loadingâ€¦")).toBeNull();
  });
});
