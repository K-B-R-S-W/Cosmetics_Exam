// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), realtimeInput: undefined as undefined | { onFlagged(id: string): void }, paused: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/hooks/useAdminLiveKit", () => ({ useAdminLiveKit: () => ({ videoTracks: {}, speakerAttemptId: null, connectionLost: false, audioBlocked: false, toggleSpeaker: vi.fn() }) }));
vi.mock("@/hooks/useViolationRealtime", () => ({ useViolationRealtime: (input: { onFlagged(id: string): void }) => { mocks.realtimeInput = input; return { liveUpdatesPaused: mocks.paused }; } }));
vi.mock("@/components/admin/ThresholdControl", () => ({ ThresholdControl: () => <label>Flag at<input aria-label="Flag at" value="10" readOnly /></label> }));
import { LiveGrid } from "./LiveGrid";

const exam = { id: "00000000-0000-4000-8000-000000000001", title: "Synthetic live exam", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 600_000).toISOString(), flag_threshold: 10 };
const attempt = (id: string, mer: string, status: "not_started" | "in_progress", violations = 0) => ({ id, status, current_position: 0, extra_minutes: 0, last_seen_at: status === "in_progress" ? new Date().toISOString() : null, violation_count: violations, submitted_at: null, candidate: { id: `candidate-${id}`, mer_code: mer, full_name: `Candidate ${mer}`, outlet: null } });

beforeEach(() => {
  mocks.replace.mockReset(); mocks.paused = false; mocks.realtimeInput = undefined;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/events")) return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ server_time: new Date().toISOString(), exams: [exam], exam, attempts: [attempt("two", "MER-10", "not_started"), attempt("one", "MER-2", "in_progress", 10)], progress: [{ attempt_id: "one", status: "in_progress", current_position: 0, total_questions: 5, answered_count: 2, flagged_count: 0 }] }), { status: 200 }));
  }));
});

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
    expect(await screen.findByRole("dialog", { name: "MER-2" })).toBeTruthy();
    mocks.realtimeInput!.onFlagged("one");
    await waitFor(() => expect(screen.getByRole("status", { name: "" }).textContent).toContain("reached the flag threshold"));
  });
});
