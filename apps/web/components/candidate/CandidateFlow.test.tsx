// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateProvider } from "./CandidateContext";
import { CheckScreen } from "./CheckScreen";
import { ConfirmScreen } from "./ConfirmScreen";
import { LoginForm } from "./LoginForm";
import { RulesScreen } from "./RulesScreen";

const navigation = vi.hoisted(() => ({
  path: "/login",
  push: vi.fn<(path: string) => void>(),
  replace: vi.fn<(path: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => navigation,
  useSearchParams: () => ({ get: () => null }),
}));

type CandidateKey = "A" | "B";
let activeCandidate: CandidateKey | null;
let attemptStatus: "not_started" | "acknowledged";
const fetchMock = vi.fn();

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
    phase: "waiting",
    exam: {
      id: `exam-${key}`,
      title: people[key].exam,
      status: "scheduled",
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
  return null;
}

function App() {
  return <CandidateProvider><CurrentPage /></CandidateProvider>;
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
  activeCandidate = null;
  attemptStatus = "not_started";
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
    if (url === "/api/auth/acknowledge") {
      attemptStatus = "acknowledged";
      return json({ attempt: { status: attemptStatus } });
    }
    if (url === "/api/auth/logout") {
      activeCandidate = null;
      return json({ ok: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateProvider flow state", () => {
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

    expect(screen.getByRole("heading", { name: "Pre-exam check" })).toBeTruthy();
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
});
