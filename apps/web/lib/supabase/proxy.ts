import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function requirePublicEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }

  return value;
}

export async function updateSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requirePublicEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requirePublicEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  // This project uses ES256 signing, so verification is local after JWKS cache.
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}
