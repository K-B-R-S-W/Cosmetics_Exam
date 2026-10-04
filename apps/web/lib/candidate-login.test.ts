import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { assertLoginAllowed, LOGIN_WINDOW_MS, pickExam, replacementIncident, retryAfterSeconds } from "./candidate-login";

describe("retryAfterSeconds", () => {
  it("waits until enough oldest failures expire", () => {
    const now = Date.parse("2026-10-04T10:10:00.000Z");
    const times = [0, 10, 20, 30, 40, 50].map((seconds) =>
      new Date(now - LOGIN_WINDOW_MS + seconds * 1000).toISOString(),
    );
    expect(retryAfterSeconds(times, 5, now)).toBe(10);
    expect(retryAfterSeconds(times.slice(0, 4), 5, now)).toBe(0);
  });
  it("rounds up and never returns zero while blocked", () => {
    const now = Date.now();
    const times = Array.from({ length: 5 }, () => new Date(now - LOGIN_WINDOW_MS + 1).toISOString());
    expect(retryAfterSeconds(times, 5, now)).toBe(1);
  });
});

describe("assertLoginAllowed", () => {
  function fakeClient(merCount: number, ipCount: number) {
    let call = 0;
    return { from: () => {
      const count = call++ === 0 ? merCount : ipCount;
      const rows = Array.from({ length: count }, (_, index) => ({ attempted_at: new Date(Date.now() - LOGIN_WINDOW_MS + 30_000 + index).toISOString() }));
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "order"]) chain[method] = vi.fn(() => chain);
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
      return chain;
    } } as never;
  }

  it("blocks the sixth request after five MER failures and allows normal shared-IP traffic", async () => {
    await expect(assertLoginAllowed(fakeClient(5, 23), "TEST-001", "192.0.2.1")).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    await expect(assertLoginAllowed(fakeClient(4, 199), "TEST-001", "192.0.2.1")).resolves.toBeUndefined();
  });

  it("blocks at the IP threshold", async () => {
    await expect(assertLoginAllowed(fakeClient(0, 200), "TEST-001", "192.0.2.1")).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("pickExam", () => {
  const scheduled = { id: "e1", title: "One", status: "scheduled" as const, raw_status: "scheduled", scheduled_start_at: null, duration_min: 45 };
  const live = { ...scheduled, id: "e2", title: "Two", status: "live" as const, raw_status: "live" };
  it("returns the sole eligible exam or a requested eligible exam", () => {
    expect(pickExam([scheduled])).toEqual(scheduled);
    expect(pickExam([scheduled, live], "e2")).toEqual(live);
  });
  it("returns each contract error", () => {
    expect(() => pickExam([])).toThrow(expect.objectContaining({ code: "no_exam_available" }));
    expect(() => pickExam([{ ...scheduled, status: "scheduled", raw_status: "ended" }])).toThrow(expect.objectContaining({ code: "exam_closed" }));
    expect(() => pickExam([scheduled, live])).toThrow(expect.objectContaining({ code: "multiple_exams", details: { exams: expect.any(Array) } }));
    expect(() => pickExam([scheduled], "other")).toThrow(expect.objectContaining({ code: "not_assigned" }));
  });
});

describe("replacementIncident", () => {
  const now = Date.parse("2026-10-04T10:00:00.000Z");
  it("counts a session seen exactly 30 seconds ago as MULTI_LOGIN", () => {
    expect(replacementIncident("2026-10-04T09:59:30.000Z", now)).toEqual({ type: "MULTI_LOGIN", counts: true });
  });
  it("uses informational RECONNECTED beyond the boundary or without a heartbeat", () => {
    expect(replacementIncident("2026-10-04T09:59:29.999Z", now)).toEqual({ type: "RECONNECTED", counts: false });
    expect(replacementIncident(null, now)).toEqual({ type: "RECONNECTED", counts: false });
  });
});
