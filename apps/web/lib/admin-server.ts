import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import type { AdminContext } from "@/lib/auth";

export async function recordAdminAction(
  client: SupabaseClient,
  admin: AdminContext,
  action: string,
  target: string | null,
  detail: Record<string, unknown> | null = null,
): Promise<void> {
  const { error } = await client.from("admin_actions").insert({
    admin_id: admin.id,
    action,
    target,
    detail,
  });

  if (error) {
    throw new ApiError(
      "service_unavailable",
      503,
      "The change was saved, but its audit record could not be written. Stop and contact support before retrying.",
    );
  }
}

export function databaseUnavailable(): ApiError {
  return new ApiError(
    "service_unavailable",
    503,
    "The database is unavailable. Try again.",
  );
}

export function quotedPostgrestPattern(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"*${escaped}*"`;
}
