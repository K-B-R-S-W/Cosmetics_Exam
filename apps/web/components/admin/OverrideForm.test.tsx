// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OverrideForm } from "./OverrideForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))); refresh.mockClear(); });

it("sends the strict override body and refreshes the server review", async () => {
  render(<OverrideForm attemptId="attempt" questionId="question" maxMarks={2} />);
  fireEvent.change(screen.getByLabelText("Marks"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Synthetic review" } });
  fireEvent.click(screen.getByRole("button", { name: "Save override" }));
  expect(await screen.findByText("Override saved.")).toBeTruthy();
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect(JSON.parse(String(init?.body))).toEqual({ question_id: "question", marks: 1.5, note: "Synthetic review" });
  expect(refresh).toHaveBeenCalledOnce();
});
