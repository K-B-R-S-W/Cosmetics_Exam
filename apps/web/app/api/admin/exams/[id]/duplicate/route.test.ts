import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  origin: vi.fn(),
  rpc: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ copy: mocks.copy, remove: mocks.remove }) },
    from: () => ({ update: mocks.update }),
  }),
}));

const sourceId = "00000000-0000-4000-8000-000000000010";
const copyId = "00000000-0000-4000-8000-000000000011";
const questionId = "00000000-0000-4000-8000-000000000012";
const mapping = {
  source_question_id: "00000000-0000-4000-8000-000000000013",
  question_id: questionId,
  source_path: "questions/admin/source.png",
  destination_path: `questions/admin/${questionId}.png`,
  alt_text: "Synthetic image",
  mime: "image/png",
  size_bytes: 123,
};

function updateResult(data: unknown = { id: questionId }, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  mocks.update.mockReturnValue(chain);
  return chain;
}

function request() {
  return new Request(`http://localhost/api/admin/exams/${sourceId}/duplicate`, { method: "POST", headers: { Origin: "http://localhost" } });
}

const context = { params: Promise.resolve({ id: sourceId }) };

describe("POST /api/admin/exams/[id]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000099", name: "Admin", role: "admin" });
    mocks.rpc.mockResolvedValue({ data: { exam_id: copyId, images: [mapping] }, error: null });
    mocks.copy.mockResolvedValue({ data: { path: mapping.destination_path }, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.audit.mockResolvedValue(undefined);
    updateResult();
  });

  it("requires same-origin admin access before duplicating", async () => {
    mocks.auth.mockRejectedValue(new AdminAuthError("forbidden", 403));
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("duplicates the definition, copies image metadata, and audits safe counts", async () => {
    const chain = updateResult();
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ exam_id: copyId, image_failures: [] });
    expect(mocks.rpc).toHaveBeenCalledWith("duplicate_exam", expect.objectContaining({ p_exam_id: sourceId }));
    expect(mocks.copy).toHaveBeenCalledWith(mapping.source_path, mapping.destination_path);
    expect(mocks.update).toHaveBeenCalledWith({ image_path: mapping.destination_path, image_alt_text: mapping.alt_text, image_mime: mapping.mime, image_size_bytes: mapping.size_bytes });
    expect(chain.eq).toHaveBeenCalledWith("exam_id", copyId);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "exam_duplicate", copyId, {
      source_exam_id: sourceId, image_count: 1, image_failures: 0,
    });
  });

  it("keeps the copy usable and reports an image-copy failure", async () => {
    mocks.copy.mockResolvedValue({ data: null, error: { message: "missing" } });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect((await response.json()).image_failures).toEqual([
      { question_id: questionId, reason: "copy_failed", orphan_leftover: false },
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("removes a copied orphan after metadata failure and reports a leftover when removal fails", async () => {
    updateResult(null, { message: "update failed" });
    mocks.remove.mockResolvedValue({ data: null, error: { message: "remove failed" } });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect((await response.json()).image_failures).toEqual([
      { question_id: questionId, reason: "metadata_update_failed", orphan_leftover: true },
    ]);
    expect(mocks.remove).toHaveBeenCalledWith([mapping.destination_path]);
    expect(mocks.warn).toHaveBeenCalledWith("duplicate_exam_image_orphan", expect.objectContaining({ errorCode: "storage_delete_failed" }));
  });
});
