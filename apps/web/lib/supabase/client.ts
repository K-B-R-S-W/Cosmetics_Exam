"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

function requirePublicEnvironment(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }

  return value;
}

export function createBrowserSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      requirePublicEnvironment(
        "NEXT_PUBLIC_SUPABASE_URL",
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
      requirePublicEnvironment(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    );
  }

  return browserClient;
}
