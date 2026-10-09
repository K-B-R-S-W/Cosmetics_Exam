import { beforeEach, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/grading/attempt-review", () => ({ loadAttemptReview: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ kind: "service" }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin", role: "admin" }); });

it("requires admin access before loading print data", async () => {
  mocks.auth.mockRejectedValue(new AdminAuthError("forbidden", 403));
  const { default: Page } = await import("./page");
  await expect(Page({ params: Promise.resolve({ attempt: "attempt" }) })).rejects.toMatchObject({ code: "forbidden" });
  expect(mocks.load).not.toHaveBeenCalled();
});

it("requests print-only metadata and images", async () => {
  mocks.load.mockResolvedValue({ attemptId: "attempt", status: "finalized", candidate: { mer_code: "MER", full_name: "Name", outlet: null }, question_numbers: [], items: [], print: { exam_title: "Exam", exam_date: null, earned_marks: 0, max_marks: 0, total_percent: null, is_final: false } });
  const { default: Page } = await import("./page");
  await Page({ params: Promise.resolve({ attempt: "attempt" }) });
  expect(mocks.load).toHaveBeenCalledWith(expect.anything(), "attempt", undefined, { includePrintData: true });
});

it("uses notFound only for a genuinely missing attempt", async () => {
  mocks.load.mockResolvedValue(null);
  const { default: Page } = await import("./page");
  await expect(Page({ params: Promise.resolve({ attempt: "missing" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  mocks.load.mockRejectedValueOnce(new Error("attempt_review_scores_failed"));
  await expect(Page({ params: Promise.resolve({ attempt: "broken" }) })).rejects.toThrow("attempt_review_scores_failed");
});
