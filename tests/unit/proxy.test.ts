import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import * as supabaseProxy from "@/lib/supabase/proxy";

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: vi.fn(),
}));

describe("Proxy SSR Middleware & Cache Header Preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves refreshed cookies and auth cache headers (cache-control, expires, pragma) on unauthenticated redirect", async () => {
    const mockSupabaseResponse = new NextResponse(null, {
      status: 200,
      headers: {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        expires: "0",
        pragma: "no-cache",
        "x-custom-internal": "do-not-leak",
      },
    });
    mockSupabaseResponse.cookies.set("sb-access-token", "refreshed-token-123", {
      path: "/",
      httpOnly: false,
    });

    vi.mocked(supabaseProxy.updateSession).mockResolvedValue({
      supabaseResponse: mockSupabaseResponse,
      user: null,
      claims: null,
      error: null,
    });

    const request = new NextRequest("http://localhost:3000/app/study-packs");
    const response = await proxy(request);

    // Assert redirect behavior
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/login?redirect=%2Fapp%2Fstudy-packs"
    );

    // Assert refreshed cookie preservation
    const cookie = response.cookies.get("sb-access-token");
    expect(cookie?.value).toBe("refreshed-token-123");

    // Assert auth cache header preservation
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-store, max-age=0, must-revalidate"
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");

    // Assert unrelated headers are NOT blindly copied
    expect(response.headers.get("x-custom-internal")).toBeNull();
  });

  it("preserves auth cache headers and cookies on authenticated redirect away from auth pages", async () => {
    const mockSupabaseResponse = new NextResponse(null, {
      status: 200,
      headers: {
        "cache-control": "private, no-cache",
        pragma: "no-cache",
      },
    });
    mockSupabaseResponse.cookies.set("sb-refresh-token", "refresh-token-456", {
      path: "/",
    });

    vi.mocked(supabaseProxy.updateSession).mockResolvedValue({
      supabaseResponse: mockSupabaseResponse,
      user: {
        id: "user-uuid-1",
      },
      claims: {
        sub: "user-uuid-1",
      } as unknown as NonNullable<
        Awaited<ReturnType<typeof supabaseProxy.updateSession>>["claims"]
      >,
      error: null,
    });

    const request = new NextRequest(
      "http://localhost:3000/auth/login?redirect=%2Fapp%2Fprofile"
    );
    const response = await proxy(request);

    // Assert redirect to safe target
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/app/profile"
    );

    // Assert cookies and headers copied
    expect(response.cookies.get("sb-refresh-token")?.value).toBe(
      "refresh-token-456"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("returns supabaseResponse unchanged when authenticated user accesses /app", async () => {
    const mockSupabaseResponse = new NextResponse(null, { status: 200 });

    vi.mocked(supabaseProxy.updateSession).mockResolvedValue({
      supabaseResponse: mockSupabaseResponse,
      user: {
        id: "user-uuid-1",
      },
      claims: {
        sub: "user-uuid-1",
      } as unknown as NonNullable<
        Awaited<ReturnType<typeof supabaseProxy.updateSession>>["claims"]
      >,
      error: null,
    });

    const request = new NextRequest("http://localhost:3000/app");
    const response = await proxy(request);

    expect(response).toBe(mockSupabaseResponse);
  });
});
