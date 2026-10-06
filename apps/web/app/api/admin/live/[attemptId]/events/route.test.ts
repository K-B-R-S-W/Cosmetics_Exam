import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), order: vi.fn(), sign: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin, AdminAuthError: class extends Error {} }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({
  from: () => ({ select: () => ({ eq: () => ({ order: mocks.order }) }) }),
  storage: { from: () => ({ createSignedUrls: mocks.sign }) },
}) }));
import { GET } from "./route";
const attemptId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue({ id: "admin" });
  mocks.order.mockReset().mockResolvedValue({ data: [{ id: "event-1", type: "FOCUS_LOST", occurred_at: new Date().toISOString(), duration_ms: null, counts: true, merged_types: [], meta: null, snapshot_path: "exam/attempt/event.jpg" }], error: null });
  mocks.sign.mockReset().mockResolvedValue({ data: [{ path: "exam/attempt/event.jpg", signedUrl: "https://example.test/signed.jpg" }], error: null });
});
describe("GET /api/admin/live/[attemptId]/events", () => {
  it("authenticates and signs snapshot thumbnails in one batch", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ attemptId }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.events[0].snapshot_url).toBe("https://example.test/signed.jpg");
    expect(mocks.sign).toHaveBeenCalledWith(["exam/attempt/event.jpg"], 300);
  });
});
