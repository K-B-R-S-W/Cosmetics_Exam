import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import {
  adminUpdateSchema,
  authMutationError,
  enabledSuperAdminCount,
  findAdmin,
  lastSuperAdminError,
  loadAdminDirectory,
} from "@/lib/admins";
import { requireSuperAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/admins/[id]";
interface RouteContext { params: Promise<{ id: string }> }

async function setRole(client: ReturnType<typeof createServiceRoleClient>, id: string, role: "admin" | "super_admin"): Promise<void> {
  const { data, error } = await client.from("admin_profiles").update({ role }).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw databaseUnavailable();
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireSuperAdmin();
    const id = z.uuid().parse((await context.params).id);
    const input = adminUpdateSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const before = await loadAdminDirectory(client);
    const target = findAdmin(before, id);
    const beforeSuperCount = enabledSuperAdminCount(before);

    if (input.action === "disable") {
      if (id === admin.id) throw new ApiError("self_lockout", 409, "You cannot disable your own account.");
      if (target.role === "super_admin" && !target.disabled && beforeSuperCount <= 1) throw lastSuperAdminError();
      const changed = await client.auth.admin.updateUserById(id, { ban_duration: "876000h" });
      if (changed.error) throw authMutationError();
      const after = await loadAdminDirectory(client);
      if (enabledSuperAdminCount(after) === 0) {
        const reverted = await client.auth.admin.updateUserById(id, { ban_duration: "none" });
        if (reverted.error) throw authMutationError();
        throw lastSuperAdminError();
      }
      await recordAdminAction(client, admin, "admin_disable", id);
      return jsonResponse({ item: findAdmin(after, id) });
    }

    if (input.action === "enable") {
      const changed = await client.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (changed.error) throw authMutationError();
      await recordAdminAction(client, admin, "admin_enable", id);
      return jsonResponse({ changed: true });
    }

    if (input.action === "role") {
      if (id === admin.id && input.role !== "super_admin") throw new ApiError("self_lockout", 409, "You cannot demote your own account.");
      if (target.role === "super_admin" && input.role !== "super_admin" && beforeSuperCount <= 1) throw lastSuperAdminError();
      await setRole(client, id, input.role);
      const after = await loadAdminDirectory(client);
      if (enabledSuperAdminCount(after) === 0) {
        await setRole(client, id, target.role);
        throw lastSuperAdminError();
      }
      await recordAdminAction(client, admin, "admin_role_change", id, { old_role: target.role, new_role: input.role });
      return jsonResponse({ item: findAdmin(after, id) });
    }

    const changed = await client.auth.admin.updateUserById(id, { password: input.password });
    if (changed.error) throw authMutationError();
    await recordAdminAction(client, admin, "admin_password_reset", id);
    return jsonResponse({ changed: true });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
