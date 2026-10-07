import { describe, expect, it, vi } from "vitest";

import { SCHEDULER_SCAN_PAGE_SIZE, createSchedulerSource } from "./supabase-source";

type Result = { data: unknown[]; error: null | { code?: string } };

function query(result: Result) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    lte: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.lte.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.range.mockReturnValue(chain);
  return chain;
}

describe("Supabase scheduler source", () => {
  it("performs three bounded reads and uses the conservative scheduled cutoff", async () => {
    const scheduled = query({ data: [{ id: "scheduled" }], error: null });
    const attempts = query({ data: [], error: null });
    const lifecycle = query({ data: [], error: null });
    const from = vi.fn((table: string) => {
      if (table === "attempts") return attempts;
      return from.mock.calls.filter(([name]) => name === "exams").length === 1 ? scheduled : lifecycle;
    });
    const source = createSchedulerSource({ from } as never);
    const cutoff = new Date("2030-01-01T00:01:00.000Z");

    await Promise.all([
      source.listScheduledExams(cutoff),
      source.listDueAttempts(cutoff),
      source.listLifecycleExams(cutoff),
    ]);

    expect(from).toHaveBeenCalledTimes(3);
    expect(scheduled.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(scheduled.lte).toHaveBeenCalledWith("scheduled_start_at", cutoff.toISOString());
    expect(attempts.in).toHaveBeenCalledWith("status", ["not_started", "acknowledged", "in_progress"]);
    expect(lifecycle.in).toHaveBeenCalledWith("status", ["live", "ended"]);
    expect(scheduled.range).toHaveBeenCalledWith(0, SCHEDULER_SCAN_PAGE_SIZE - 1);
    expect(from.mock.calls.map(([table]) => table)).not.toContain("answers");
  });

  it("includes ordinary and force-ended attempts up to 60 seconds early but excludes later rows", async () => {
    const attempts = query({
      data: [
        { id: "ordinary", exam_id: "exam-1", status: "not_started", extra_minutes: 2, exams: { status: "live", ends_at: "2029-12-31T23:58:00Z", force_ended_at: null } },
        { id: "forced", exam_id: "exam-2", status: "acknowledged", extra_minutes: 99, exams: { status: "ended", ends_at: "2030-01-01T00:00:00Z", force_ended_at: "2030-01-01T00:00:30Z" } },
        { id: "later", exam_id: "exam-3", status: "in_progress", extra_minutes: 0, exams: { status: "live", ends_at: "2030-01-01T00:01:00Z", force_ended_at: null } },
      ],
      error: null,
    });
    const source = createSchedulerSource({ from: vi.fn(() => attempts) } as never);

    await expect(source.listDueAttempts(new Date("2030-01-01T00:01:00Z"))).resolves.toEqual([
      { id: "ordinary", exam_id: "exam-1", status: "not_started", extra_minutes: 2 },
      { id: "forced", exam_id: "exam-2", status: "acknowledged", extra_minutes: 99 },
    ]);
  });

  it("uses every ordinary extra-minute value for lifecycle candidacy and ignores extra time on force-end", async () => {
    const lifecycle = query({
      data: [
        { id: "ordinary-due", status: "live", ends_at: "2029-12-31T23:58:00Z", force_ended_at: null, attempts: [{ extra_minutes: 0 }, { extra_minutes: 2 }] },
        { id: "ordinary-later", status: "live", ends_at: "2029-12-31T23:59:30Z", force_ended_at: null, attempts: [{ extra_minutes: 2 }] },
        { id: "force-due", status: "ended", ends_at: "2030-01-01T00:00:30Z", force_ended_at: "2030-01-01T00:00:30Z", attempts: [{ extra_minutes: 120 }] },
      ],
      error: null,
    });
    const source = createSchedulerSource({ from: vi.fn(() => lifecycle) } as never);

    await expect(source.listLifecycleExams(new Date("2030-01-01T00:01:00Z"))).resolves.toEqual([
      { id: "ordinary-due" },
      { id: "force-due" },
    ]);
  });

  it("always applies the ordinary exam deadline when selecting lifecycle work", async () => {
    const lifecycle = query({
      data: [
        { id: "zero-inside-window", status: "live", ends_at: "2030-01-01T00:01:00Z", force_ended_at: null, attempts: [] },
        { id: "zero-past-window", status: "live", ends_at: "2030-01-01T00:00:44Z", force_ended_at: null, attempts: [] },
        { id: "closed-attempt-with-extension", status: "live", ends_at: "2030-01-01T00:00:00Z", force_ended_at: null, attempts: [{ extra_minutes: 2 }] },
        { id: "open-attempt-past-window", status: "live", ends_at: "2030-01-01T00:00:00Z", force_ended_at: null, attempts: [{ extra_minutes: 0 }] },
        { id: "force-ended-before-ordinary-end", status: "ended", ends_at: "2030-01-01T01:00:00Z", force_ended_at: "2030-01-01T00:00:30Z", attempts: [] },
      ],
      error: null,
    });
    const source = createSchedulerSource({ from: vi.fn(() => lifecycle) } as never);

    await expect(source.listLifecycleExams(new Date("2030-01-01T00:01:00Z"))).resolves.toEqual([
      { id: "zero-past-window" },
      { id: "open-attempt-past-window" },
      { id: "force-ended-before-ordinary-end" },
    ]);
  });

  it("does not select ended exams as scheduled starts", async () => {
    const scheduled = query({ data: [], error: null });
    const source = createSchedulerSource({ from: vi.fn(() => scheduled) } as never);

    await source.listScheduledExams(new Date("2030-01-01T00:01:00Z"));

    expect(scheduled.eq).toHaveBeenCalledWith("status", "scheduled");
  });

  it("continues to the next ordered page when a scan hits 500 rows", async () => {
    const firstPage = Array.from({ length: SCHEDULER_SCAN_PAGE_SIZE }, (_, index) => ({ id: `exam-${index}` }));
    const first = query({ data: firstPage, error: null });
    const second = query({ data: [{ id: "exam-overflow" }], error: null });
    const from = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const source = createSchedulerSource({ from } as never);

    const result = await source.listScheduledExams(new Date("2030-01-01T00:01:00Z"));

    expect(result).toHaveLength(501);
    expect(result.at(-1)).toEqual({ id: "exam-overflow" });
    expect(first.range).toHaveBeenCalledWith(0, 499);
    expect(second.range).toHaveBeenCalledWith(500, 999);
  });
});
