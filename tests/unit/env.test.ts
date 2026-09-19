import { describe, it, expect } from "vitest";
import { parseEnv } from "@/config/env";

describe("Environment Configuration & Boundary", () => {
  const validPublishableKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

  it("parses valid environment when publishable key is provided with defaults for other vars", () => {
    const config = parseEnv({
      NODE_ENV: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_APP_NAME: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validPublishableKey,
    });

    expect(config.NODE_ENV).toBe("development");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Atlas");
    expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      validPublishableKey
    );
  });

  it("handles empty strings on optional vars by falling back to safe defaults", () => {
    const config = parseEnv({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "",
      NEXT_PUBLIC_APP_NAME: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validPublishableKey,
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Atlas");
    expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      validPublishableKey
    );
  });

  it("fails clearly when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      })
    ).toThrow("Invalid environment configuration");
  });

  it("fails clearly when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is empty string", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      })
    ).toThrow("Invalid environment configuration");
  });

  it("accepts valid custom URLs with non-standard ports and paths", () => {
    const config = parseEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://medstudy.test:8443/app",
      NEXT_PUBLIC_APP_NAME: "MedStudy Production",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.local:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validPublishableKey,
    });

    expect(config.NODE_ENV).toBe("production");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("https://medstudy.test:8443/app");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Production");
    expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://supabase.local:54321"
    );
    expect(config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      validPublishableKey
    );
  });

  it("rejects malformed URLs strictly", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "not-a-valid-url",
        NEXT_PUBLIC_APP_NAME: "MedStudy Atlas",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validPublishableKey,
      })
    ).toThrow("Invalid environment configuration");
  });

  it("rejects invalid NODE_ENV values", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "staging" as unknown as undefined,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_NAME: "MedStudy Atlas",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: validPublishableKey,
      })
    ).toThrow("Invalid environment configuration");
  });
});
