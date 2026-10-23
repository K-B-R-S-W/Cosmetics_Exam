import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import type { AdminRole } from "@/lib/auth";

const AUTH_PAGE_SIZE = 1_000;
const PROFILE_PAGE_SIZE = 1_000;

export const adminCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "super_admin"]),
  password: z.string().min(12).max(128),
}).strict();

export const adminUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("enable") }).strict(),
  z.object({ action: z.literal("role"), role: z.enum(["admin", "super_admin"]) }).strict(),
  z.object({ action: z.literal("reset_password"), password: z.string().min(12).max(128) }).strict(),
]);

export interface AdminDirectoryItem {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  disabled: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

type Profile = { id: string; name: string; role: AdminRole };

export function authUserDisabled(user: Pick<User, "banned_until">, now = Date.now()): boolean {
  return Boolean(user.banned_until && new Date(user.banned_until).getTime() > now);
}

export async function listAllAuthUsers(client: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (result.error) throw new ApiError("service_unavailable", 503, "Admin accounts could not be loaded. Try again.");
    users.push(...result.data.users);
    if (result.data.users.length < AUTH_PAGE_SIZE) return users;
  }
}

async function listAllProfiles(client: SupabaseClient): Promise<Profile[]> {
  const profiles: Profile[] = [];
  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await client.from("admin_profiles").select("id,name,role").order("id").range(from, from + PROFILE_PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new ApiError("service_unavailable", 503, "Admin accounts could not be loaded. Try again.");
    profiles.push(...data as Profile[]);
    if (data.length < PROFILE_PAGE_SIZE) return profiles;
  }
}

export async function loadAdminDirectory(client: SupabaseClient): Promise<AdminDirectoryItem[]> {
  const [users, profiles] = await Promise.all([listAllAuthUsers(client), listAllProfiles(client)]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  return profiles.map((profile) => {
    const user = usersById.get(profile.id);
    if (!user) throw new ApiError("service_unavailable", 503, "An admin profile has no matching Auth account. Contact support.");
    return {
      ...profile,
      email: user.email ?? "",
      disabled: authUserDisabled(user),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
    };
  });
}

export function enabledSuperAdminCount(items: AdminDirectoryItem[]): number {
  return items.filter((item) => item.role === "super_admin" && !item.disabled).length;
}

export function findAdmin(items: AdminDirectoryItem[], id: string): AdminDirectoryItem {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new ApiError("not_found", 404, "Admin not found.");
  return item;
}

export function lastSuperAdminError(): ApiError {
  return new ApiError("last_super_admin", 409, "At least one enabled super admin must remain.");
}

export function authMutationError(): ApiError {
  return new ApiError("service_unavailable", 503, "The admin account could not be changed. Try again.");
}
