import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireServerEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
