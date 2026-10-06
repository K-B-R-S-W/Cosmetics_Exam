import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireCandidate: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: mocks.maybeSingle,
    };
    return { from: vi.fn(() => query) };
  },
}));

import { POST } from "./route";

const SECRET = "synthetic-livekit-secret-32-chars-minimum";
const EXAM_ID = "20000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "10000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "40000000-0000-4000-8000-000000000004";
const ADMIN_ID = "30000000-0000-4000-8000-000000000003";

function request(body: unknown, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/livekit/token", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function candidateRow(attemptStatus = "acknowledged", examStatus = "scheduled") {
  return {
    id: ATTEMPT_ID,
    status: attemptStatus,
    candidate_id: CANDIDATE_ID,
    exam_id: EXAM_ID,
    candidates: { mer_code: "MER-0042" },
    exams: { status: examStatus },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LIVEKIT_URL = "ws://localhost:7880";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = SECRET;
  mocks.requireAdmin.mockResolvedValue({ id: ADMIN_ID, name: "Synthetic Admin", role: "admin" });
  mocks.requireCandidate.mockResolvedValue({
    candidateId: CANDIDATE_ID,
    attemptId: ATTEMPT_ID,
    examId: EXAM_ID,
    attemptStatus: "acknowledged",
  });
  mocks.maybeSingle.mockResolvedValue({ data: candidateRow(), error: null });
});

afterEach(() => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

describe("POST /api/livekit/token", () => {
  it("returns a candidate token using the contract identity, name, metadata and grants", async () => {
    const response = await POST(request({ as: "candidate" }));
    const body = await response.json();
    const claims = await new TokenVerifier("devkey", SECRET).verify(body.token);
    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      url: "ws://localhost:7880",
      room: `exam_${EXAM_ID}`,
      identity: `c_${ATTEMPT_ID}`,
    }));
    expect(claims.name).toBe("MER-0042");
    expect(claims.metadata).toBeTypeOf("string");
    expect(JSON.parse(claims.metadata!)).toEqual({ attempt_id: ATTEMPT_ID, mer_code: "MER-0042" });
    expect(claims.video).toEqual(expect.objectContaining({
      canPublish: true,
      canPublishSources: ["camera", "microphone"],
      canSubscribe: false,
      canPublishData: false,
    }));
    expect(mocks.requireCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("returns a hidden subscribe-only admin token without a database exam lookup", async () => {
    const response = await POST(request({ as: "admin", exam_id: EXAM_ID }));
    const body = await response.json();
    const claims = await new TokenVerifier("devkey", SECRET).verify(body.token);
    expect(response.status).toBe(200);
    expect(body.identity).toBe(`a_${ADMIN_ID}`);
    expect(claims.video).toEqual(expect.objectContaining({
      hidden: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    }));
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.requireCandidate).not.toHaveBeenCalled();
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it.each([
    ["not_started", "scheduled"],
    ["submitted", "live"],
    ["acknowledged", "draft"],
    ["in_progress", "ended"],
    ["in_progress", "finalized"],
  ])("returns exam_closed for attempt %s and exam %s", async (attemptStatus, examStatus) => {
    mocks.maybeSingle.mockResolvedValue({ data: candidateRow(attemptStatus, examStatus), error: null });
    const response = await POST(request({ as: "candidate" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "exam_closed", message: "The exam has ended.", details: null },
    });
  });

  it("rejects unknown body keys through the strict schema", async () => {
    const response = await POST(request({ as: "candidate", exam_id: EXAM_ID }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(mocks.requireCandidate).not.toHaveBeenCalled();
  });

  it("rejects a bad admin exam id", async () => {
    const response = await POST(request({ as: "admin", exam_id: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("checks origin before parsing or authentication", async () => {
    const response = await POST(new Request("http://localhost/api/livekit/token", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.requireCandidate).not.toHaveBeenCalled();
  });

  it("returns service_unavailable when LiveKit configuration is missing without logging secrets", async () => {
    delete process.env.LIVEKIT_API_SECRET;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request({ as: "admin", exam_id: EXAM_ID }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "service_unavailable", message: "Live video is unavailable. Your exam can continue.", details: null },
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET);
    error.mockRestore();
  });

  it("returns service_unavailable when the candidate lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "database details" } });
    const response = await POST(request({ as: "candidate" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("service_unavailable");
  });
});
