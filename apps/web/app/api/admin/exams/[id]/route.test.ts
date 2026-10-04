import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
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

describe("exam detail route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ id: "admin-1" }); mocks.audit.mockResolvedValue(undefined); mocks.from.mockImplementation(() => loadQuery()); });
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

  it.each([null, "2020-01-01T00:00:00.000Z"])(
    "rejects an invalid scheduled start-time edit (%s)",
    async (scheduledStartAt) => {
      const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2099-10-05T04:00:00.000Z" };
      mocks.from.mockImplementation(() => loadQuery(scheduled));
      const { PATCH } = await import("./route");
      const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ scheduled_start_at: scheduledStartAt }) }), { params: Promise.resolve({ id: exam.id }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatchObject({
        code: "not_ready",
        details: { missing: ["start_time"] },
      });
    },
  );

  it("allows a title-only edit to an already scheduled exam", async () => {
    const scheduled = { ...exam, status: "scheduled", scheduled_start_at: "2099-10-05T04:00:00.000Z" };
    const updateResult = updateQuery({ ...scheduled, title: "Renamed", questions: undefined, exam_candidates: undefined });
    mocks.from.mockImplementationOnce(() => loadQuery(scheduled)).mockImplementationOnce(() => updateResult);
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Renamed" }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(200);
    expect(updateResult.update).toHaveBeenCalledWith({ title: "Renamed" });
  });
});
