// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./Toast";

function Harness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Saved successfully")}>Success</button>
      <button onClick={() => toast.error("Save failed")}>Error</button>
      {[1, 2, 3, 4, 5].map((number) => (
        <button key={number} onClick={() => toast.error(`Error ${number}`)}>
          Error {number}
        </button>
      ))}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("announces success politely and dismisses it after about four seconds", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Harness /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Success" }));

    const toast = screen.getByRole("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.getByText("Saved successfully")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved successfully")).toBeNull();
  });

  it("keeps errors until they are closed and announces them assertively", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Harness /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^Error$/ }));

    const toast = screen.getByRole("alert");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText("Save failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByText("Save failed")).toBeNull();
  });

  it("shows at most the four newest notifications", () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    for (const number of [1, 2, 3, 4, 5]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Error ${number}$`) }));
    }

    expect(
      screen.getAllByRole("alert").map((item) => item.textContent),
    ).toEqual([
      "Error 2×",
      "Error 3×",
      "Error 4×",
      "Error 5×",
    ]);
  });

  it("positions the notification container at the top right", () => {
    render(<ToastProvider><Harness /></ToastProvider>);

    const container = screen.getByTestId("toast-container");
    expect(container.className).toContain("fixed");
    expect(container.className).toContain("right-5");
    expect(container.className).toContain("top-5");
  });
});
