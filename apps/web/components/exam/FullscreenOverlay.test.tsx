// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullscreenOverlay } from "./FullscreenOverlay";
describe("FullscreenOverlay", () => {
  it("blocks visibly until restore is requested", () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const view = render(<FullscreenOverlay active onRestore={restore} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to fullscreen" }));
    expect(restore).toHaveBeenCalled();
    view.rerender(<FullscreenOverlay active={false} onRestore={restore} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
