// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoTile } from "./VideoTile";

const attempt = { id: "a", status: "in_progress" as const, current_position: 0, extra_minutes: 0, last_seen_at: null, violation_count: 10, submitted_at: null, candidate: { id: "c", mer_code: "MER-0412", full_name: "A. Perera", outlet: null } };
describe("VideoTile", () => {
  it("has separate tile and speaker focus stops with a complete accessible name", () => {
    const open = vi.fn(); const speaker = vi.fn();
    render(<VideoTile attempt={attempt} status="In exam" threshold={10} progress="14 answered" speakerOn={false} onOpen={open} onToggleSpeaker={speaker} />);
    fireEvent.click(screen.getByRole("button", { name: /MER-0412 A. Perera, In exam, 10 violations, flagged/ }));
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(open).toHaveBeenCalledOnce(); expect(speaker).toHaveBeenCalledOnce();
    expect(screen.getByText("No camera")).toBeTruthy();
    expect(screen.getByText("14 answered")).toBeTruthy();
  });
});
