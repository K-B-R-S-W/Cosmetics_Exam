import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { adminCreateSchema, loadAdminDirectory } from "@/lib/admins";
import { requireSuperAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/admins";

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    return jsonResponse({ items: await loadAdminDirectory(createServiceRoleClient()) });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

function duplicateEmail(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const value = `${String(candidate?.code ?? "")} ${String(candidate?.message ?? "")}`.toLowerCase();
  return value.includes("email_exists") || value.includes("already") || value.includes("registered");
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireSuperAdmin();
    const input = adminCreateSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const created = await client.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      if (duplicateEmail(created.error)) throw new ApiError("duplicate_email", 409, "An account with that email already exists.");
      throw new ApiError("service_unavailable", 503, "The Auth account could not be created. Try again.");
    }

    const { error: profileError } = await client.from("admin_profiles").insert({
      id: created.data.user.id,
      name: input.name,
      role: input.role,
    });
    if (profileError) {
      await client.auth.admin.deleteUser(created.data.user.id);
      throw databaseUnavailable();
    }
    await recordAdminAction(client, admin, "admin_create", created.data.user.id, { role: input.role });
    return jsonResponse({ item: {
      id: created.data.user.id,
      name: input.name,
      email: created.data.user.email ?? input.email,
      role: input.role,
      disabled: false,
      created_at: created.data.user.created_at,
      last_sign_in_at: created.data.user.last_sign_in_at ?? null,
    } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
