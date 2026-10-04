// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TiptapEditor } from "./TiptapEditor";

afterEach(() => cleanup());

describe("TiptapEditor", () => {
  it("offers only the approved toolbar controls and applies Sinhala language metadata", async () => {
    render(<TiptapEditor ariaLabel="Question text" maxLength={50_000} value="<p>සිංහල ප්‍රශ්නය</p>" onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Heading 2" })).toBeTruthy();
    expect(screen.getByLabelText("Font size")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /subscript/i })).toBeNull();
    expect(screen.getByRole("toolbar").closest("div")?.parentElement?.getAttribute("lang")).toBe("si");
  });

  it("does not offer headings in an option editor", async () => {
    render(<TiptapEditor ariaLabel="Option A text" headings={false} maxLength={5_000} value="<p>Choice</p>" onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Heading 2" })).toBeNull();
  });
});
