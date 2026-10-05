// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThresholdControl } from "./ThresholdControl";
afterEach(() => vi.unstubAllGlobals());
describe("ThresholdControl", () => {
  it("rejects out-of-range values and saves a valid value", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
    render(<ThresholdControl examId="exam" initialValue={10} />); const input = screen.getByLabelText("Flag at");
    fireEvent.change(input, { target: { value: "101" } }); fireEvent.blur(input); expect(screen.getByText("Enter a number from 1 to 100.")).toBeTruthy(); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "8" } }); fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/exams/exam", expect.objectContaining({ body: JSON.stringify({ flag_threshold: 8 }) })));
    expect(await screen.findByText("Flag threshold set to 8.")).toBeTruthy();
  });
});
