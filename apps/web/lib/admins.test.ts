import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { adminCreateSchema, adminUpdateSchema, listAllAuthUsers } from "./admins";

vi.mock("server-only", () => ({}));

describe("admin account contracts", () => {
  it("requires 12-character create and reset passwords", () => {
    expect(adminCreateSchema.safeParse({ name: "Admin", email: "a@example.com", role: "admin", password: "short" }).success).toBe(false);
    expect(adminCreateSchema.safeParse({ name: "Admin", email: "A@EXAMPLE.COM", role: "admin", password: "twelve-chars" }).data?.email).toBe("a@example.com");
    expect(adminUpdateSchema.safeParse({ action: "reset_password", password: "short" }).success).toBe(false);
  });

  it("fetches every Auth page instead of stopping at the default page", async () => {
    const first = Array.from({ length: 1_000 }, (_, index) => ({ id: `user-${index}` })) as User[];
    const last = [{ id: "user-1000" }] as User[];
    const listUsers = vi.fn()
      .mockResolvedValueOnce({ data: { users: first }, error: null })
      .mockResolvedValueOnce({ data: { users: last }, error: null });
    const client = { auth: { admin: { listUsers } } } as unknown as SupabaseClient;
    expect(await listAllAuthUsers(client)).toHaveLength(1_001);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1_000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1_000 });
  });
});
