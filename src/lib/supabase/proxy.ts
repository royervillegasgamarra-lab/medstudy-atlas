import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/env";
import type { Database } from "@/types/database";

/**
 * Updates session tokens in cookies via Next.js Proxy.
 * Uses supabase.auth.getClaims() to verify the JWT and refresh the session
 * according to official Supabase SSR guidance.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
              supabaseResponse.headers.set(key, value);
            });
          }
        },
      },
    }
  );

  // Use getClaims() for token verification and session refresh
  const { data, error } = await supabase.auth.getClaims();

  // If claims exist and sub is present, user is authenticated
  const user = data?.claims?.sub ? { id: data.claims.sub as string } : null;

  return { supabaseResponse, user, claims: data?.claims ?? null, error };
}
