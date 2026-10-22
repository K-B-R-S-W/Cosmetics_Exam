// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OverrideForm } from "./OverrideForm";
import { ToastProvider } from "@/components/ui/Toast";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))); refresh.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderForm() {
  return render(<ToastProvider><OverrideForm attemptId="attempt" questionId="question" maxMarks={2} /></ToastProvider>);
}

it("sends the strict override body and refreshes the server review", async () => {
  renderForm();
  fireEvent.change(screen.getByLabelText("Marks"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Synthetic review" } });
  fireEvent.click(screen.getByRole("button", { name: "Save override" }));
  expect(await within(screen.getByTestId("toast-container")).findByText("Override saved.")).toBeTruthy();
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect(JSON.parse(String(init?.body))).toEqual({ question_id: "question", marks: 1.5, note: "Synthetic review" });
  expect(refresh).toHaveBeenCalledOnce();
});

it("shows a persistent error toast when the override fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
  renderForm();
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Synthetic review" } });

  fireEvent.click(screen.getByRole("button", { name: "Save override" }));

  expect(await within(screen.getByTestId("toast-container")).findByRole("alert")).toHaveProperty("textContent", "Could not save override.×");
  expect(refresh).not.toHaveBeenCalled();
});
