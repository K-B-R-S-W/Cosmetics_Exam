import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

it("authenticates without rendering the normal admin shell", async () => {
  mocks.auth.mockResolvedValue({ id: "admin", name: "Admin", role: "admin" });
  const { default: Layout } = await import("./layout");
  const html = renderToStaticMarkup(await Layout({ children: <main>Print document</main> }));
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(html).toContain("Print document");
  expect(html).not.toContain("admin-shell");
});

it("preserves the admin login redirect on an ended session", async () => {
  mocks.auth.mockRejectedValue(new AdminAuthError("unauthenticated", 401));
  const { default: Layout } = await import("./layout");
  await expect(Layout({ children: <main>Print document</main> })).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/admin/login?reason=session-ended&returnTo=%2Fadmin");
});
