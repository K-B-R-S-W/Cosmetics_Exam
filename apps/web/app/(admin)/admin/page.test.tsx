import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: mocks.from }),
}));

import AdminPage from "./page";

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ order: mocks.order });
    mocks.order.mockReturnValue({ limit: mocks.limit });
  });

  it("falls back to the exam list when loading live exams fails", async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { message: "Synthetic failure" } });

    await AdminPage();

    expect(mocks.from).toHaveBeenCalledWith("exams");
    expect(mocks.select).toHaveBeenCalledWith("id, status, started_at");
    expect(mocks.eq).toHaveBeenCalledWith("status", "live");
    expect(mocks.order).toHaveBeenCalledWith("started_at", { ascending: true });
    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/exams");
  });
});
