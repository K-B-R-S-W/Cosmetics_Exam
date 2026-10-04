import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertLoginAllowed: vi.fn(),
  getDummyNicHash: vi.fn(),
  pickExam: vi.fn(),
  replacementIncident: vi.fn(),
  verifyNic: vi.fn(),
  createSession: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-login", () => ({
  assertLoginAllowed: mocks.assertLoginAllowed,
  clientIp: (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  getDummyNicHash: mocks.getDummyNicHash,
  pickExam: mocks.pickExam,
  replacementIncident: mocks.replacementIncident,
}));
vi.mock("@/lib/hashing", () => ({ verifyNic: mocks.verifyNic }));
vi.mock("@/lib/candidate-session", () => ({ createCandidateSession: mocks.createSession }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));

import { ApiError } from "@/lib/api";
import { POST } from "./route";

type DbResult = { data?: unknown; error?: unknown };
function query(result: DbResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "gte", "order", "update", "insert"]) chain[method] = vi.fn(() => chain);
  for (const method of ["maybeSingle", "single"]) chain[method] = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  chain.then = (resolve: (value: DbResult) => unknown) => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve);
  return chain;
}

function client(queues: Record<string, DbResult[]>) {
  const inserts: Array<{ table: string; value: unknown }> = [];
  const calls: string[] = [];
  return {
    inserts,
    calls,
    from: vi.fn((table: string) => {
      calls.push(table);
      const chain = query(queues[table]?.shift() ?? { data: null });
      chain.insert = vi.fn((value: unknown) => {
        inserts.push({ table, value });
        return chain;
      });
      return chain;
    }),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost", "x-forwarded-for": "192.0.2.10, 10.0.0.1", "user-agent": "Synthetic browser" }, body: JSON.stringify(body) });
}

const candidate = { id: "00000000-0000-4000-8000-000000000010", mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training", nic_hash: "hash", active: true };
const exam = { id: "00000000-0000-4000-8000-000000000020", title: "Synthetic Exam", status: "scheduled", scheduled_start_at: null, duration_min: 45 };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.assertLoginAllowed.mockResolvedValue(undefined);
  mocks.getDummyNicHash.mockResolvedValue("dummy-hash");
  mocks.pickExam.mockReturnValue(exam);
  mocks.replacementIncident.mockReturnValue({ type: "MULTI_LOGIN", counts: true });
  mocks.createSession.mockResolvedValue(undefined);
});

describe("POST /api/auth/login", () => {
  it.each([
    ["unknown MER", null, true, "dummy-hash"],
    ["wrong ID", candidate, false, "hash"],
    ["inactive", { ...candidate, active: false }, true, "hash"],
    ["malformed ID", candidate, false, "hash"],
  ])("returns the identical credential response for %s", async (_label, row, matches, expectedHash) => {
    mocks.verifyNic.mockResolvedValue(matches);
    const db = client({ candidates: [{ data: row }], login_attempts: [{ data: null }] });
    mocks.createClient.mockReturnValue(db);
    const response = await POST(request({ mer_code: " test-001 ", nic: "invalid synthetic" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "invalid_credentials", message: "Your MER code or ID number doesn't match our records. Check both and try again. If it still doesn't work, ask the exam team.", details: null } });
    expect(mocks.verifyNic).toHaveBeenCalledTimes(1);
    expect(mocks.verifyNic).toHaveBeenCalledWith("invalid synthetic", expectedHash);
    expect(db.inserts).toEqual([
      {
        table: "login_attempts",
        value: { mer_code: "TEST-001", ip: "192.0.2.10", success: false },
      },
    ]);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("does not record a blocked request", async () => {
    mocks.assertLoginAllowed.mockRejectedValue(new ApiError("rate_limited", 429, "Too many tries. Wait and try again.", { retry_after_s: 42 }));
    const db = client({});
    mocks.createClient.mockReturnValue(db);
    const response = await POST(request({ mer_code: "TEST-001", nic: "200012345678" }));
    expect(response.status).toBe(429);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.verifyNic).not.toHaveBeenCalled();
    expect((await response.json()).error.details.retry_after_s).toBe(42);
  });

  it("creates one session, revokes older sessions, and records MULTI_LOGIN at the 30 second boundary", async () => {
    mocks.verifyNic.mockResolvedValue(true);
    const lastSeen = new Date(Date.now() - 30_000).toISOString();
    const db = client({
      candidates: [{ data: candidate }],
      login_attempts: [{ data: null }],
      exam_candidates: [{ data: [{ exams: exam }] }],
      attempts: [{ data: { id: "a", status: "in_progress", last_seen_at: lastSeen } }],
      sessions: [
        { data: [{ id: "old", ip: "192.0.2.9", created_at: "2026-10-04T00:00:00Z" }] },
        { data: { id: "new" } },
      ],
      violation_events: [{ data: null }],
    });
    mocks.createClient.mockReturnValue(db);
    const response = await POST(request({ mer_code: "TEST-001", nic: "200012345678" }));
    expect(response.status).toBe(200);
    expect(mocks.verifyNic).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ next: "check", attempt: { status: "in_progress" } });
    expect(mocks.createSession).toHaveBeenCalledWith("new", 45);
    expect(db.from).toHaveBeenCalledWith("violation_events");
    expect(db.inserts).toContainEqual({
      table: "login_attempts",
      value: { mer_code: "TEST-001", ip: "192.0.2.10", success: true },
    });
    expect(db.calls.indexOf("login_attempts")).toBeLessThan(
      db.calls.indexOf("attempts"),
    );
    expect(db.calls.indexOf("exam_candidates")).toBeLessThan(
      db.calls.indexOf("attempts"),
    );
  });

  it("does not create or revoke sessions for an already submitted attempt", async () => {
    mocks.verifyNic.mockResolvedValue(true);
    const db = client({ candidates: [{ data: candidate }], login_attempts: [{ data: null }], exam_candidates: [{ data: [{ exams: exam }] }], attempts: [{ data: { id: "a", status: "submitted", last_seen_at: null } }] });
    mocks.createClient.mockReturnValue(db);
    const response = await POST(request({ mer_code: "TEST-001", nic: "200012345678" }));
    expect(response.status).toBe(409);
    expect(mocks.verifyNic).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalledWith("sessions");
  });
});
