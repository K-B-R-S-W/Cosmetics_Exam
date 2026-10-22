import { describe, expect, it } from "vitest";

import { adminLandingPath } from "./admin-landing";

describe("adminLandingPath", () => {
  it("opens the live exam", () => {
    expect(
      adminLandingPath([
        { id: "exam-live", status: "live", started_at: "2026-10-22T04:00:00Z" },
      ]),
    ).toBe("/admin/live?exam=exam-live");
  });

  it("opens the exam list when there are no exams", () => {
    expect(adminLandingPath([])).toBe("/admin/exams");
  });

  it("ignores scheduled exams", () => {
    expect(
      adminLandingPath([
        { id: "exam-scheduled", status: "scheduled", started_at: null },
      ]),
    ).toBe("/admin/exams");
  });

  it("opens the earliest-started exam when more than one is live", () => {
    expect(
      adminLandingPath([
        { id: "exam-later", status: "live", started_at: "2026-10-22T05:00:00Z" },
        { id: "exam-earlier", status: "live", started_at: "2026-10-22T03:00:00Z" },
      ]),
    ).toBe("/admin/live?exam=exam-earlier");
  });
});
