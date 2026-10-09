// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/grading/attempt-review", () => ({ loadAttemptReview: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ kind: "service" }) }));
vi.mock("@/components/admin/AttemptReview", () => ({ AttemptReview: () => <div>Review</div> }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

beforeEach(() => {
  mocks.auth.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.load.mockResolvedValue({ attemptId: "attempt", status: "finalized", candidate: { mer_code: "MER-1", full_name: "Candidate", outlet: null }, question_numbers: [1], items: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("links the review header to the candidate print page", async () => {
  const { default: Page } = await import("./page");
  render(await Page({ params: Promise.resolve({ attempt: "attempt" }) }));
  expect(screen.getByRole("link", { name: "Print" }).getAttribute("href")).toBe("/admin/results/attempt/print");
});
