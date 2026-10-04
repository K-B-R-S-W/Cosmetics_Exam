// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/editor/TiptapEditor", () => ({
  TiptapEditor: ({ ariaLabel }: { ariaLabel: string }) => <div aria-label={ariaLabel} />,
}));

import { McqOptions } from "./McqOptions";

afterEach(() => cleanup());

describe("McqOptions", () => {
  it("clears the answer key when the correct option is removed", () => {
    const onChange = vi.fn();
    const onCorrectChange = vi.fn();
    const options = [
      { id: "00000000-0000-4000-8000-000000000101", text_html: "A" },
      { id: "00000000-0000-4000-8000-000000000102", text_html: "B" },
      { id: "00000000-0000-4000-8000-000000000103", text_html: "C" },
    ];
    render(<McqOptions options={options} correctOptionId={options[1]!.id} onChange={onChange} onCorrectChange={onCorrectChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(onCorrectChange).toHaveBeenCalledWith(null);
    expect(onChange).toHaveBeenCalledWith([options[0], options[2]]);
  });
});
