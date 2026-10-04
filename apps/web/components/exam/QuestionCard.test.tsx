// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";

afterEach(cleanup);

const base = { id: "q", position: 0, body_html: "<p>සිංහල question</p>", image: null, marks: 1 } as const;

describe("QuestionCard", () => {
  it("renders an accessible MCQ in saved option order with Sinhala language", () => {
    const onChange = vi.fn();
    render(<QuestionCard question={{ ...base, type: "mcq", options: [{ id: "b", text_html: "<p>දෙක</p>" }, { id: "a", text_html: "<p>One</p>" }] }} answer={{ answer_text: null, selected_option_id: null, flagged: false }} disabled={false} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Choose one answer for question 1" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["b", "a"]);
    expect(screen.getByText("සිංහල question").closest("div")?.getAttribute("lang")).toBe("si");
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selected_option_id: "b" }));
    expect(screen.getByText("1 mark")).toBeTruthy();
  });

  it("renders written input with the 20,000-character controls", () => {
    render(<QuestionCard question={{ ...base, type: "written", marks: 2.5 }} answer={{ answer_text: "x".repeat(19_000), selected_option_id: null, flagged: false }} disabled={false} onChange={vi.fn()} />);
    const textarea = screen.getByLabelText("Your answer") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(20_000);
    expect(textarea.getAttribute("spellcheck")).toBe("false");
    expect(textarea.getAttribute("autocomplete")).toBe("off");
    expect(screen.getByText("1000 characters left")).toBeTruthy();
    expect(screen.getByText("2.5 marks")).toBeTruthy();
  });

  it("shows an image-unavailable state with Retry", () => {
    render(<QuestionCard question={{ ...base, type: "written", image: { url: "/api/question-images/q", alt_text: "Synthetic diagram" } }} answer={{ answer_text: null, selected_option_id: null, flagged: false }} disabled={false} onChange={vi.fn()} />);
    fireEvent.error(screen.getByAltText("Synthetic diagram"));
    expect(screen.getByText("Image could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByAltText("Synthetic diagram")).toBeTruthy();
  });
});
