import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { getSafeRedirectUrl } from "@/modules/identity/validation";

/**
 * Next.js 16 Proxy running on incoming requests.
 * Refreshes auth session cookies and handles route protection.
 */
export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);

  const { pathname } = request.nextUrl;

  // Helper to construct redirects that preserve updated session cookies and auth cache headers
  function createRedirectResponse(url: URL) {
    const response = NextResponse.redirect(url);
    // Copy any cookies set during updateSession (refreshed tokens or cleared session)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });

    // Copy auth cache headers produced by @supabase/ssr
    const cacheHeaders = ["cache-control", "expires", "pragma"] as const;
    for (const header of cacheHeaders) {
      const value = supabaseResponse.headers.get(header);
      if (value) {
        response.headers.set(header, value);
      }
    }

    return response;
  }

  // Protect /app and sub-routes
  if (pathname.startsWith("/app")) {
    if (!user) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/auth/login";
      redirectUrl.searchParams.set("redirect", pathname);
      return createRedirectResponse(redirectUrl);
    }
  }

  // Redirect already authenticated users away from login/signup
  if (
    pathname.startsWith("/auth/login") ||
    pathname.startsWith("/auth/signup")
  ) {
    if (user) {
      const rawRedirect = request.nextUrl.searchParams.get("redirect");
      const safeTarget = getSafeRedirectUrl(rawRedirect);
      const targetUrl = new URL(safeTarget, request.url);
      return createRedirectResponse(targetUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/app/:path*", "/auth/:path*"],
};
