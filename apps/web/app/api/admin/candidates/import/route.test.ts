import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertSameOrigin: vi.fn(),
  hashNic: vi.fn(),
  existing: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/origin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/origin")>()),
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/hashing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashing")>()),
  hashNic: mocks.hashNic,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "admin_actions") {
        return { insert: mocks.audit };
      }
      return {
        select: vi.fn(() => ({ in: mocks.existing })),
        upsert: mocks.upsert,
      };
    }),
  })),
}));

const SYNTHETIC_ROWS = [
  {
    mer_code: "TEST-001",
    full_name: "නිර්මාණ පරීක්ෂක",
    outlet: "පුහුණු ශාඛාව",
    nic: "190000000000",
  },
  {
    mer_code: "TEST-002",
    full_name: "Synthetic Candidate Two",
    outlet: "Training Outlet",
    nic: "999990000X",
  },
];

function request(body: unknown): Request {
  return new Request("http://localhost/api/admin/candidates/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("candidate import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test Admin",
      role: "admin",
    });
    mocks.existing.mockResolvedValue({ data: [], error: null });
    mocks.hashNic.mockResolvedValue("$argon2id$synthetic-hash");
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.audit.mockResolvedValue({ error: null });
  });

  it("dry-run performs only the pre-query and no hashing or writes", async () => {
    mocks.existing.mockResolvedValue({
      data: [{ mer_code: "TEST-002" }],
      error: null,
    });
    const { POST } = await import("./route");

    const response = await POST(
      request({ rows: SYNTHETIC_ROWS, on_duplicate: "skip", dry_run: true }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dry_run: true,
      created: 1,
      updated: 0,
      skipped: 1,
      errors: [],
    });
    expect(mocks.hashNic).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requireAdmin.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects later normalized duplicates within a server batch", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        rows: [SYNTHETIC_ROWS[0], { ...SYNTHETIC_ROWS[1], mer_code: " test-001 " }],
        dry_run: true,
      }),
    );
    const body = await response.json();

    expect(body.created).toBe(1);
    expect(body.errors).toEqual([
      expect.objectContaining({ row: 2, code: "duplicate_mer_in_batch" }),
    ]);
    expect(mocks.hashNic).not.toHaveBeenCalled();
  });

  it("hashes only applicable rows and performs one skip-mode bulk upsert", async () => {
    mocks.existing.mockResolvedValue({
      data: [{ mer_code: "TEST-002" }],
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(
      request({ rows: SYNTHETIC_ROWS, on_duplicate: "skip", dry_run: false }),
    );

    expect(response.status).toBe(200);
    expect(mocks.hashNic).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          mer_code: "TEST-001",
          full_name: "නිර්මාණ පරීක්ෂක",
          outlet: "පුහුණු ශාඛාව",
        }),
      ],
      { onConflict: "mer_code", ignoreDuplicates: true },
    );
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("reports a failed bulk statement as a wholly unapplied batch", async () => {
    mocks.upsert.mockResolvedValue({ error: { code: "synthetic_failure" } });
    const { POST } = await import("./route");
    const response = await POST(
      request({ rows: SYNTHETIC_ROWS, on_duplicate: "update", dry_run: false }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      code: "batch_not_applied",
      details: { attempted: 2 },
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
