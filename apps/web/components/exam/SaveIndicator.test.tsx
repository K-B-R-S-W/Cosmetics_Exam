// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByTestId("save-indicator").textContent).toContain(words);
    expect(screen.getByTestId("save-indicator").querySelector("[aria-hidden=true]")).toBeTruthy();
  });

  it("formats confirmed save time in Asia/Colombo", () => {
    render(<SaveIndicator state={{ kind: "saved", durable: true, savedAt: "2026-10-04T08:32:00.000Z" }} />);
    expect(screen.getByTestId("save-indicator").textContent).toContain("Saved 14:02");
  });

  it("uses truthful durable and memory-only offline copy", () => {
    const { rerender } = render(<SaveIndicator state={{ kind: "offline", durable: true, savedAt: null }} />);
    expect(screen.getByTestId("save-indicator").textContent).toContain("Answers are kept on this device");
    rerender(<SaveIndicator state={{ kind: "offline", durable: false, savedAt: null }} />);
    expect(screen.getByTestId("save-indicator").textContent).toContain("Keep this window open");
    expect(screen.getByTestId("save-indicator").textContent).not.toContain("kept on this device");
  });

  it("shows failed with a warning icon", () => {
    render(<SaveIndicator state={{ kind: "failed", durable: true, savedAt: null }} />);
    expect(screen.getByTestId("save-indicator").textContent).toContain("Could not save this answer. Tell the exam team.");
    expect(screen.getByTestId("save-indicator").querySelector("[aria-hidden=true]")?.textContent).toBe("⚠");
  });

  it("announces only problem states and the return to Saved", async () => {
    const { rerender } = render(<SaveIndicator state={{ kind: "waiting", durable: true, savedAt: null }} />);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<SaveIndicator state={{ kind: "saving", durable: true, savedAt: null }} />);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<SaveIndicator state={{ kind: "saved", durable: true, savedAt: "2026-10-04T08:32:00.000Z" }} />);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<SaveIndicator state={{ kind: "offline", durable: true, savedAt: null }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Offline"));
    rerender(<SaveIndicator state={{ kind: "retrying", durable: true, savedAt: null }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Reconnecting"));
    rerender(<SaveIndicator state={{ kind: "saved", durable: true, savedAt: "2026-10-04T08:33:00.000Z" }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved 14:03"));
    rerender(<SaveIndicator state={{ kind: "waiting", durable: true, savedAt: null }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
  });
});
