// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let nowMs = Date.parse("2026-10-04T10:00:00.000Z");
vi.mock("@/lib/time", () => ({ useServerClock: () => () => nowMs }));

import { formatExamTime, Timer } from "./Timer";

afterEach(cleanup);

describe("Timer", () => {
  it("formats the exam clock and never goes negative", () => {
    expect(formatExamTime(3_661_000)).toBe("1:01:01");
    expect(formatExamTime(61_000)).toBe("01:01");
    expect(formatExamTime(-1)).toBe("00:00");
    render(<Timer deadline="2026-10-04T09:59:59.000Z" />);
    expect(screen.getByRole("timer").textContent).toContain("Time is up");
  });

  it("announces only the specified thresholds once", () => {
    const deadline = "2026-10-04T10:30:00.000Z";
    const view = render(<Timer deadline={deadline} />);
    expect(screen.getByText("30 minutes left.")).toBeTruthy();
    nowMs = Date.parse("2026-10-04T10:20:00.000Z");
    view.rerender(<Timer deadline={deadline} />);
    expect(screen.getByText("10 minutes left.")).toBeTruthy();
    view.rerender(<Timer deadline={deadline} />);
    expect(screen.getAllByText("10 minutes left.")).toHaveLength(1);
  });

  it("calls the expiry callback at zero", () => {
    const expired = vi.fn();
    nowMs = Date.parse("2026-10-04T10:30:00.000Z");
    render(<Timer deadline="2026-10-04T10:30:00.000Z" onExpired={expired} />);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("can expire again after the deadline is extended", () => {
    const expired = vi.fn();
    nowMs = Date.parse("2026-10-04T10:30:00.000Z");
    const view = render(<Timer deadline="2026-10-04T10:30:00.000Z" onExpired={expired} />);
    expect(expired).toHaveBeenCalledTimes(1);
    view.rerender(<Timer deadline="2026-10-04T10:45:00.000Z" onExpired={expired} />);
    nowMs = Date.parse("2026-10-04T10:45:00.000Z");
    view.rerender(<Timer deadline="2026-10-04T10:45:00.000Z" onExpired={expired} />);
    expect(expired).toHaveBeenCalledTimes(2);
  });
});
