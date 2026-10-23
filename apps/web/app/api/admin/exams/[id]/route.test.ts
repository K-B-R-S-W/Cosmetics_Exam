import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), from: vi.fn(), audit: vi.fn(),
  counts: vi.fn(), paths: vi.fn(), cleanup: vi.fn(), warn: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/exam-delete", () => ({ loadExamDeleteCounts: mocks.counts, loadExamStoragePaths: mocks.paths, removeExamStorage: mocks.cleanup }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from }) }));

const exam = { id: "00000000-0000-4000-8000-000000000010", title: "Exam", instructions: null, scheduled_start_at: "2026-10-05T04:00:00Z", started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00Z", questions: [{ count: 0 }], exam_candidates: [{ count: 1 }] };
function loadQuery(data: Record<string, unknown> = exam) { return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }; }
function updateQuery(data: Record<string, unknown> | null) {
  const chain = {
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return { update: vi.fn(() => chain), chain };
}
function gradingQuery(rows: Array<{ id: string }> = []) {
  return { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) };
}
function deleteQuery(data: { id: string } | null = { id: exam.id }) {
  const chain = {
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return { delete: vi.fn(() => chain), chain };
}
function deleteRequest() {
  return new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "DELETE", headers: { Origin: "http://localhost" } });
}
const context = { params: Promise.resolve({ id: exam.id }) };

describe("exam detail route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", name: "Admin", role: "admin" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.counts.mockResolvedValue({ questions: 2, assigned_candidates: 3, attempts: 4, results: 1 });
    mocks.paths.mockResolvedValue({ questionImages: ["admin/q.jpg"], snapshots: [`snapshots/${exam.id}/attempt/event.jpg`] });
    mocks.cleanup.mockResolvedValue(0);
    mocks.from.mockImplementation(() => loadQuery());
  });
  afterEach(() => { vi.useRealTimers(); });
  it("refuses scheduling without every Section 2C blocker satisfied", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ status: "scheduled" }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "not_ready", details: { missing: ["questions"] } });
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
  });
  it("locks flag_threshold after finalization", async () => {
    mocks.from.mockImplementation(() => loadQuery({ ...exam, status: "finalized" }));
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ flag_threshold: 8 }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "exam_locked", details: { locked_fields: ["flag_threshold"] } });
  });
  it("allows an ended-exam threshold change and audits old/new values", async () => {
    const ended = { ...exam, status: "ended", started_at: "2026-10-04T00:00:00Z", ends_at: "2026-10-04T01:00:00Z" };
    const updateResult = updateQuery({ ...ended, flag_threshold: 8, questions: undefined, exam_candidates: undefined });
    mocks.from.mockImplementationOnce(() => loadQuery(ended)).mockImplementationOnce(() => updateResult);
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ flag_threshold: 8 }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(200);
    expect(updateResult.update).toHaveBeenCalledWith({ flag_threshold: 8 });
    expect(updateResult.chain.eq).toHaveBeenCalledWith("status", "ended");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "exam_update", exam.id, { old_flag_threshold: 10, new_flag_threshold: 8 });
  });

  it("returns exam_locked when the status changes before the conditional update", async () => {
    const updateResult = updateQuery(null);
    mocks.from.mockImplementationOnce(() => loadQuery(exam)).mockImplementationOnce(() => updateResult);
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Changed" }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "exam_locked",
      message: "The exam changed. Reload and try again.",
    });
    expect(updateResult.chain.eq).toHaveBeenCalledWith("status", "draft");
  });

  it("allows an unchanged near-future start time with a title edit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-10-05T03:59:30.000Z"));
    try {
      const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2099-10-05T04:00:00.000Z" };
      const updateResult = updateQuery({ ...scheduled, title: "Renamed", questions: undefined, exam_candidates: undefined });
      mocks.from.mockImplementationOnce(() => loadQuery(scheduled)).mockImplementationOnce(() => updateResult);
      const { PATCH } = await import("./route");
      const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Renamed", scheduled_start_at: "2099-10-05T04:00:00.000Z" }) }), { params: Promise.resolve({ id: exam.id }) });
      expect(response.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows moving a scheduled exam with an unchanged past start time back to draft", async () => {
    const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2020-01-01T00:00:00.000Z" };
    const updateResult = updateQuery({ ...scheduled, status: "draft", questions: undefined, exam_candidates: undefined });
    mocks.from.mockImplementationOnce(() => loadQuery(scheduled)).mockImplementationOnce(() => updateResult);
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ status: "draft", scheduled_start_at: "2020-01-01T00:00:00.000Z" }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(200);
  });

  it.each([
    ["changed start to the past", "2020-01-01T00:00:00.000Z"],
    ["cleared start", null],
  ])("rejects a %s", async (_caseName, scheduledStartAt) => {
    const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2099-10-05T04:00:00.000Z" };
    mocks.from.mockImplementation(() => loadQuery(scheduled));
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ scheduled_start_at: scheduledStartAt }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "not_ready",
      details: { missing: ["start_time"] },
    });
  });

  it("allows a title-only edit to an already scheduled exam", async () => {
    const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2099-10-05T04:00:00.000Z" };
    const updateResult = updateQuery({ ...scheduled, title: "Renamed", questions: undefined, exam_candidates: undefined });
    mocks.from.mockImplementationOnce(() => loadQuery(scheduled)).mockImplementationOnce(() => updateResult);
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Renamed" }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(200);
    expect(updateResult.update).toHaveBeenCalledWith({ title: "Renamed" });
  });

  it.each(["draft", "scheduled", "finalized"] as const)("conditionally deletes an allowed %s exam", async (status) => {
    if (status === "finalized") mocks.requireAdmin.mockResolvedValue({ id: "admin-1", name: "Super", role: "super_admin" });
    const current = { ...exam, status };
    const removal = deleteQuery();
    mocks.from.mockImplementationOnce(() => loadQuery(current)).mockImplementationOnce(() => gradingQuery()).mockImplementationOnce(() => removal);
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(200);
    expect(removal.chain.in).toHaveBeenCalledWith("status", status === "finalized" ? ["draft", "scheduled", "finalized"] : ["draft", "scheduled"]);
    expect(mocks.paths).toHaveBeenCalledBefore(mocks.cleanup);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "exam_delete", exam.id, {
      title: "Exam", status, questions: 2, assigned_candidates: 3, attempts: 4, results: 1,
    });
  });

  it.each([
    ["live", "A live exam cannot be deleted."],
    ["ended", "This exam is still finalizing. Try again in a minute."],
  ] as const)("blocks %s exams", async (status, message) => {
    mocks.from.mockImplementation(() => loadQuery({ ...exam, status }));
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(message);
    expect(mocks.counts).not.toHaveBeenCalled();
  });

  it("requires a super admin for finalized exams", async () => {
    mocks.from.mockImplementation(() => loadQuery({ ...exam, status: "finalized" }));
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe("Only a super admin can delete a finalized exam.");
  });

  it.each(["running", "paused"])("blocks deletion while grading is %s", async (runStatus) => {
    mocks.from.mockImplementationOnce(() => loadQuery()).mockImplementationOnce(() => gradingQuery([{ id: `run-${runStatus}` }]));
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe("Wait for grading to finish before deleting this exam.");
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("does not delete an exam that changes to a blocked status", async () => {
    const removal = deleteQuery(null);
    mocks.from.mockImplementationOnce(() => loadQuery()).mockImplementationOnce(() => gradingQuery()).mockImplementationOnce(() => removal);
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("reports storage leftovers after deletion without undoing the delete", async () => {
    const removal = deleteQuery();
    mocks.cleanup.mockResolvedValue(2);
    mocks.from.mockImplementationOnce(() => loadQuery()).mockImplementationOnce(() => gradingQuery()).mockImplementationOnce(() => removal);
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, storage_failed: 2, warnings: ["exam deleted, 2 files could not be removed"] });
    expect(mocks.warn).toHaveBeenCalledWith("exam_delete_storage_incomplete", expect.objectContaining({ failureCount: 2 }));
  });

  it("returns success with a warning if the post-delete audit fails", async () => {
    const removal = deleteQuery();
    mocks.audit.mockRejectedValue(new Error("synthetic audit failure"));
    mocks.from.mockImplementationOnce(() => loadQuery()).mockImplementationOnce(() => gradingQuery()).mockImplementationOnce(() => removal);
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toContain("Exam deleted, but its audit record could not be written. Contact support.");
  });

  it("rejects a non-admin before loading delete data", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminAuthError("forbidden", 403));
    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
