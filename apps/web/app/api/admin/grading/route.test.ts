import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/grading/admin-data", () => ({ loadGradingProgress: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ kind: "service" }) }));

it("allows a regular admin and returns the safe progress projection", async () => {
  mocks.auth.mockResolvedValue({ id: "admin", role: "admin" }); mocks.load.mockResolvedValue({ runs: [], queue: {}, keys: [{ label: "key1", used: 1, limit: 10 }], logs: [], not_graded: 0 });
  const exam = "00000000-0000-4000-8000-000000000010"; const { GET } = await import("./route");
  const response = await GET(new Request(`http://localhost/api/admin/grading?exam_id=${exam}`));
  expect(response.status).toBe(200); expect(mocks.load).toHaveBeenCalledWith(expect.anything(), exam); expect(JSON.stringify(await response.json())).not.toContain("secret");
});
