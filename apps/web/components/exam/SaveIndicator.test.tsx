// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SaveIndicator } from "./SaveIndicator";

afterEach(cleanup);

describe("SaveIndicator", () => {
  it.each([
    ["waiting", "Waiting to save"],
    ["saving", "Saving…"],
    ["retrying", "Reconnecting…"],
  ] as const)("renders %s with words and an icon", (kind, words) => {
    render(<SaveIndicator state={{ kind, durable: true, savedAt: null }} />);
    expect(screen.getByRole("status").textContent).toContain(words);
    expect(screen.getByRole("status").querySelector("[aria-hidden=true]")).toBeTruthy();
  });

  it("formats confirmed save time in Asia/Colombo", () => {
    render(<SaveIndicator state={{ kind: "saved", durable: true, savedAt: "2026-10-04T08:32:00.000Z" }} />);
    expect(screen.getByRole("status").textContent).toContain("Saved 14:02");
  });

  it("uses truthful durable and memory-only offline copy", () => {
    const { rerender } = render(<SaveIndicator state={{ kind: "offline", durable: true, savedAt: null }} />);
    expect(screen.getByRole("status").textContent).toContain("Answers are kept on this device");
    rerender(<SaveIndicator state={{ kind: "offline", durable: false, savedAt: null }} />);
    expect(screen.getByRole("status").textContent).toContain("Keep this window open");
    expect(screen.getByRole("status").textContent).not.toContain("kept on this device");
  });
});
