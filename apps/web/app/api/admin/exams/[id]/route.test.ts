import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from }) }));

const exam = { id: "00000000-0000-4000-8000-000000000010", title: "Exam", instructions: null, scheduled_start_at: "2026-10-05T04:00:00Z", started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00Z", questions: [{ count: 0 }], exam_candidates: [{ count: 1 }] };
function loadQuery(data: Record<string, unknown> = exam) { return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }; }

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
    const update = vi.fn(() => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: { ...ended, flag_threshold: 8, questions: undefined, exam_candidates: undefined }, error: null }),
        }),
      }),
    }));
    mocks.from.mockImplementationOnce(() => loadQuery(ended)).mockImplementationOnce(() => ({ update }));
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request(`http://localhost/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ flag_threshold: 8 }) }), { params: Promise.resolve({ id: exam.id }) });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ flag_threshold: 8 });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "exam_update", exam.id, { old_flag_threshold: 10, new_flag_threshold: 8 });
  });
});
