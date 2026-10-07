// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CandidatePanel } from "./CandidatePanel";

const attempt = { id: "attempt-1", status: "in_progress" as const, current_position: 0, extra_minutes: 0, last_seen_at: null, violation_count: 1, submitted_at: null, candidate: { id: "candidate-1", mer_code: "MER-1", full_name: "Synthetic Candidate", outlet: null } };
describe("CandidatePanel", () => {
  it("shows camera-off guidance, closes on Escape and restores focus", () => {
    const close = vi.fn();
    const returnFocus = document.createElement("button");
    document.body.append(returnFocus);
    const focus = vi.spyOn(returnFocus, "focus");
    const view = render(<CandidatePanel examId="exam-1" attempt={attempt} status="Camera off" threshold={10} progress="2 answered" speakerOn={false} events={[]} eventsLoading={false} onClose={close} onToggleSpeaker={vi.fn()} onEventsChanged={vi.fn()} returnFocus={returnFocus} />);
    expect(screen.getByRole("complementary", { name: "Candidate MER-1" })).toBeTruthy();
    expect(screen.getByText("No video received. The camera may be off, or the connection to the video server may be down.")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(focus).toHaveBeenCalledOnce();
    returnFocus.remove();
  });

  it("leaves Escape to a nested dialog", () => {
    const close = vi.fn();
    render(<CandidatePanel examId="exam-1" attempt={attempt} status="In exam" threshold={10} progress="2 answered" speakerOn={false} events={[]} eventsLoading={false} onClose={close} onToggleSpeaker={vi.fn()} onEventsChanged={vi.fn()} returnFocus={null} />);
    const nested = document.createElement("div");
    nested.setAttribute("role", "dialog");
    document.body.append(nested);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    nested.remove();
  });
});
