// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrintResult, cssString } from "./PrintResult";

const print = {
  exam_title: "අවසන් විභාගය",
  exam_date: "2026-10-09T03:30:00.000Z",
  earned_marks: 3,
  max_marks: 5,
  total_percent: 60,
  is_final: false,
};

const items = [
  { question_id: "q1", paper_number: 1, admin_number: 3, type: "mcq" as const, question: "Pick one", answer: "", model_answer: "", selected_option: { label: "a", text: "Wrong" }, correct_option: { label: "b", text: "Right" }, selected_correct: false, image: null, max_marks: 1, score: { source: "mcq", marks: 0, reason: null, needs_review: false, details: null } },
  { question_id: "q2", paper_number: 2, admin_number: 7, type: "written" as const, question: "සිංහල ප්‍රශ්නය", answer: "පිළිතුර\nදෙවන පේළිය", model_answer: "රහස් ආදර්ශය", selected_option: null, correct_option: null, selected_correct: null, image: { url: "https://signed.test/image.jpg", alt_text: "Synthetic diagram" }, max_marks: 4, score: null },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps model answers out of the DOM until the default-off checkbox is selected", () => {
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "නම", outlet: "Colombo" }} print={print} items={items} />);
  const checkbox = screen.getByRole("checkbox", { name: "Include model answers" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  expect(screen.queryByText("රහස් ආදර්ශය")).toBeNull();
  expect(screen.queryByText("b. Right")).toBeNull();
  fireEvent.click(checkbox);
  expect(screen.getByText("රහස් ආදර්ශය")).toBeTruthy();
  expect(screen.getByText("b. Right")).toBeTruthy();
});

it("prints through the browser and links back to the review", () => {
  const printWindow = vi.spyOn(window, "print").mockImplementation(() => undefined);
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={{ ...print, is_final: true }} items={items} />);
  fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));
  expect(printWindow).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/admin/results/attempt");
  expect(screen.getByText("Final")).toBeTruthy();
});

it.each([
  [{ ...items[0], selected_correct: true }, "Correct"],
  [{ ...items[0], selected_correct: false }, "Incorrect"],
  [{ ...items[0], selected_option: null, selected_correct: null }, "No answer"],
] as const)("shows the MCQ verdict in words", (item, verdict) => {
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={[item]} />);
  expect(screen.getAllByText(verdict).length).toBeGreaterThan(0);
});

it("shows written Not graded, preserves line breaks and assigns Sinhala language", () => {
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={[items[1]]} />);
  expect(screen.getByText("Not graded")).toBeTruthy();
  expect(screen.getByText((_, element) => element?.textContent === "පිළිතුර\nදෙවන පේළිය").className).toContain("whitespace-pre-wrap");
  expect(screen.getByText("සිංහල ප්‍රශ්නය").getAttribute("lang")).toBe("si");
  expect(screen.getByRole("img", { name: "Synthetic diagram" }).getAttribute("loading")).toBe("eager");
});

it("shows Image unavailable without dropping the rest of the question", () => {
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={[{ ...items[1], image: { url: null, alt_text: "Missing", image_missing: true as const } }]} />);
  expect(screen.getByText("Image unavailable")).toBeTruthy();
  expect(screen.getByText("Not graded")).toBeTruthy();
});

it("turns a failed eager image into Image unavailable without dropping the question", () => {
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={[items[1]]} />);
  fireEvent.error(screen.getByRole("img", { name: "Synthetic diagram" }));
  expect(screen.getByText("Image unavailable")).toBeTruthy();
  expect(screen.getByText("Not graded")).toBeTruthy();
});

it("prints override source, reason and Needs review in words", () => {
  const reviewed = { ...items[1], score: { source: "override", marks: 2, reason: "Reviewed manually", needs_review: true, details: null } };
  render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={[reviewed]} />);
  expect(screen.getByText("Override")).toBeTruthy();
  expect(screen.getByText("Reviewed manually")).toBeTruthy();
  expect(screen.getByText("Needs review")).toBeTruthy();
});

it("uses words rather than colour classes to carry result meaning", () => {
  const { container } = render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: "Candidate", outlet: null }} print={print} items={items} />);
  expect(container.textContent).toContain("Not final");
  expect(container.innerHTML).not.toMatch(/text-(alert|ok|warn)|bg-(alert|ok|warn)/);
});

it("scopes A4 print rules and prevents question blocks from splitting", () => {
  const css = readFileSync(resolve(process.cwd(), "styles/globals.css"), "utf8");
  expect(css).toContain("@page candidate-result");
  expect(css).toMatch(/\.print-result\s*{[\s\S]*?page:\s*candidate-result/);
  expect(css).toMatch(/\.print-question\s*{[\s\S]*?break-inside:\s*avoid/);
  expect(css).toMatch(/\.print-result\s*{[\s\S]*?width:\s*100%/);
  expect(css).toMatch(/\.print-result\s*{[\s\S]*?max-width:\s*100%/);
  expect(css).toMatch(/\.print-result\s*{[\s\S]*?min-width:\s*0/);
  expect(css).toMatch(/\.print-result\s*{[\s\S]*?overflow:\s*visible/);
  expect(css).toMatch(/html:has\(\.print-route\),\s*body:has\(\.print-route\)\s*{[\s\S]*?height:\s*auto/);
  expect(css).toMatch(/html:has\(\.print-route\),\s*body:has\(\.print-route\)\s*{[\s\S]*?width:\s*auto/);
  expect(css).toMatch(/html:has\(\.print-route\),\s*body:has\(\.print-route\)\s*{[\s\S]*?max-width:\s*100%/);
  expect(css).toMatch(/html:has\(\.print-route\),\s*body:has\(\.print-route\)\s*{[\s\S]*?overflow:\s*visible/);
  expect(css).toMatch(/\.print-question[^{]*{[\s\S]*?overflow-wrap:\s*anywhere/);
  expect(css).not.toContain(".admin-shell:has(.print-result)");
  expect(css).not.toContain(".print-footer-identity");
  expect(css).toContain('counter(page) " of " counter(pages)');
});

it("escapes the page-margin identity as inert CSS while preserving Sinhala", () => {
  const hostile = 'Name "\\\n</style><script>x</script>&\u0001 සිංහල';
  const escaped = cssString(hostile);
  expect(escaped).toContain('Name \\"\\\\\\a ');
  expect(escaped).toContain("\\3c /style\\3e \\3c script\\3e x\\3c /script\\3e \\26 ");
  expect(escaped).toContain("සිංහල");
  expect(escaped).not.toContain("</style>");
  expect(escaped).not.toContain("\u0001");

  const { container } = render(<PrintResult attemptId="attempt" candidate={{ mer_code: "MER-1", full_name: hostile, outlet: null }} print={print} items={[]} />);
  const style = container.querySelector("style[data-print-page]");
  expect(style?.textContent).toContain("@page candidate-result");
  expect(style?.textContent).toContain('@bottom-left');
  expect(style?.textContent).not.toContain("</style>");
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".print-footer-identity")).toBeNull();
});
