import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => ({ from: mocks.from })),
}));

function thenableQuery<T>(result: T) {
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  return query;
}

describe("candidate list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test Admin",
      role: "admin",
    });
  });

  it("omits exam options on ordinary pagination and search requests", async () => {
    const candidates = thenableQuery({ data: [], error: null, count: 0 });
    mocks.from.mockImplementation((table: string) => {
      if (table !== "candidates") throw new Error("unexpected table");
      return candidates;
    });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/candidates?page=2&q=TEST"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [], total: 0 });
    expect(mocks.from).not.toHaveBeenCalledWith("exams");
  });

  it("returns exam options only when explicitly requested", async () => {
    const candidates = thenableQuery({ data: [], error: null, count: 0 });
    const exams = thenableQuery({
      data: [{ id: "exam-1", title: "Synthetic Exam", status: "draft" }],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === "candidates" ? candidates : exams,
    );
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/admin/candidates?include=exam_options",
      ),
    );
    const body = await response.json();

    expect(body.exam_options).toEqual([
      { id: "exam-1", title: "Synthetic Exam", status: "draft" },
    ]);
    expect(mocks.from).toHaveBeenCalledWith("exams");
  });
});
