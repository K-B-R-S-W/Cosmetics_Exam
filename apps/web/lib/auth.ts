import "server-only";

import { cache } from "react";

import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export type AdminRole = "admin" | "super_admin";

export interface AdminContext {
  id: string;
  name: string;
  role: AdminRole;
}

export type AdminAuthErrorCode = "unauthenticated" | "forbidden";

export class AdminAuthError extends Error {
  constructor(
    readonly code: AdminAuthErrorCode,
    readonly status: 401 | 403,
  ) {
    super(
      code === "unauthenticated"
        ? "You need to sign in."
        : "You don't have permission to do that.",
    );
    this.name = "AdminAuthError";
  }

  toResponse(): Response {
    return Response.json(
      {
        error: {
          code: this.code,
          message: this.message,
          details: null,
        },
      },
      {
        status: this.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

async function loadAdmin(): Promise<AdminContext> {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    throw new AdminAuthError("unauthenticated", 401);
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile, error: profileError } = await serviceClient
    .from("admin_profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("admin_profile_lookup_failed");
  }

  if (!profile) {
    throw new AdminAuthError("forbidden", 403);
  }

  return profile as AdminContext;
}

export const requireAdmin = cache(loadAdmin);

export const requireSuperAdmin = cache(async (): Promise<AdminContext> => {
  const admin = await requireAdmin();

  if (admin.role !== "super_admin") {
    throw new AdminAuthError("forbidden", 403);
  }

  return admin;
});
