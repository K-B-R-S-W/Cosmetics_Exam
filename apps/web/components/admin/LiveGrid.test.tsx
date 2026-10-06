// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), realtimeInput: undefined as undefined | { onFlagged(id: string): void; onViolationChanged(id: string | null): void }, paused: false, connectionLost: false, response: undefined as unknown, videoTracks: {}, dynamicServerTime: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/hooks/useAdminLiveKit", () => ({ useAdminLiveKit: () => ({ videoTracks: mocks.videoTracks, speakerAttemptId: null, connectionLost: mocks.connectionLost, audioBlocked: false, toggleSpeaker: vi.fn() }) }));
vi.mock("@/hooks/useViolationRealtime", () => ({ useViolationRealtime: (input: { onFlagged(id: string): void; onViolationChanged(id: string | null): void }) => { mocks.realtimeInput = input; return { liveUpdatesPaused: mocks.paused }; } }));
vi.mock("@/components/admin/ThresholdControl", () => ({ ThresholdControl: () => <label>Flag at<input aria-label="Flag at" value="10" readOnly /></label> }));
import { LiveGrid } from "./LiveGrid";

const exam = { id: "00000000-0000-4000-8000-000000000001", title: "Synthetic live exam", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 600_000).toISOString(), flag_threshold: 10 };
const attempt = (id: string, mer: string, status: "not_started" | "in_progress", violations = 0) => ({ id, status, current_position: 0, extra_minutes: 0, last_seen_at: status === "in_progress" ? new Date().toISOString() : null, violation_count: violations, submitted_at: null, candidate: { id: `candidate-${id}`, mer_code: mer, full_name: `Candidate ${mer}`, outlet: null } });

beforeEach(() => {
  mocks.replace.mockReset(); mocks.paused = false; mocks.connectionLost = false; mocks.realtimeInput = undefined; mocks.dynamicServerTime = true;
  mocks.response = { server_time: new Date().toISOString(), exams: [exam], exam, attempts: [attempt("two", "MER-10", "not_started"), attempt("one", "MER-2", "in_progress", 10)], progress: [{ attempt_id: "one", status: "in_progress", current_position: 0, total_questions: 5, answered_count: 2, flagged_count: 0 }] };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/events")) return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    const response = mocks.response as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify(mocks.dynamicServerTime ? { ...response, server_time: new Date(Date.now()).toISOString() } : response), { status: 200 }));
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("LiveGrid", () => {
  it("keeps normalized MER order and filters without reordering", async () => {
    render(<LiveGrid />);
    const candidateButtons = await screen.findAllByRole("button", { name: /Candidate MER-/ });
    expect(candidateButtons[0]!.getAttribute("aria-label")).toContain("MER-2");
    expect(candidateButtons[1]!.getAttribute("aria-label")).toContain("MER-10");
    fireEvent.click(screen.getByRole("button", { name: "Not joined (1)" }));
    expect(screen.getByRole("button", { name: /MER-10 Candidate MER-10/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /MER-2 Candidate MER-2/ })).toBeNull();
  });

  it("opens the 440px candidate panel and announces a threshold crossing", async () => {
    render(<LiveGrid />);
    const tile = await screen.findByRole("button", { name: /MER-2 Candidate MER-2/ });
    fireEvent.click(tile);
    expect(await screen.findByRole("complementary", { name: "Candidate MER-2" })).toBeTruthy();
    mocks.realtimeInput!.onFlagged("one");
    await waitFor(() => expect(screen.getByRole("status", { name: "" }).textContent).toContain("reached the flag threshold"));
  });

  it("uses server time for offline status and the countdown despite a skewed admin clock", async () => {
    const localNow = Date.parse("2026-10-01T00:00:00Z");
    const serverNow = Date.parse("2026-10-02T00:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(localNow);
    mocks.dynamicServerTime = false;
    const skewedExam = { ...exam, ends_at: new Date(serverNow + 600_000).toISOString() };
    mocks.response = { server_time: new Date(serverNow).toISOString(), exams: [skewedExam], exam: skewedExam, attempts: [{ ...attempt("one", "MER-2", "in_progress"), last_seen_at: new Date(serverNow - 30_000).toISOString() }], progress: [] };
    render(<LiveGrid />);
    expect(await screen.findByRole("button", { name: /MER-2 Candidate MER-2, Offline/ })).toBeTruthy();
    expect(screen.getByText("Time left 10:00")).toBeTruthy();
  });

  it("does not derive Camera off while the admin LiveKit room is down", async () => {
    mocks.connectionLost = true;
    render(<LiveGrid />);
    expect(await screen.findByRole("button", { name: /MER-2 Candidate MER-2, In exam/ })).toBeTruthy();
    expect(screen.getByText("Video is not available. Status, progress and violations still update.")).toBeTruthy();
  });

  it("restarts the ten-second camera-off window after a LiveKit reconnect", async () => {
    vi.useFakeTimers();
    const view = render(<LiveGrid />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: /MER-2 Candidate MER-2, In exam/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole("button", { name: /MER-2 Candidate MER-2, Camera off/ })).toBeTruthy();

    mocks.connectionLost = true;
    view.rerender(<LiveGrid />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: /MER-2 Candidate MER-2, In exam/ })).toBeTruthy();

    mocks.connectionLost = false;
    view.rerender(<LiveGrid />);
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(screen.getByRole("button", { name: /MER-2 Candidate MER-2, In exam/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("button", { name: /MER-2 Candidate MER-2, Camera off/ })).toBeTruthy();
  });

  it("reloads an open candidate timeline for that candidate's Realtime violation change", async () => {
    render(<LiveGrid />);
    fireEvent.click(await screen.findByRole("button", { name: /MER-2 Candidate MER-2/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/live/one/events", { cache: "no-store" }));
    const before = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/events")).length;
    mocks.realtimeInput!.onViolationChanged("one");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/events"))).toHaveLength(before + 1));
  });
});
