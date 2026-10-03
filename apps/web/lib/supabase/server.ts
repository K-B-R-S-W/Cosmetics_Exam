import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: async (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. Proxy refreshes them.
          }
        },
      },
    },
  );
}
