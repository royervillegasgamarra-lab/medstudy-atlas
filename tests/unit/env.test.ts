import { describe, it, expect } from "vitest";
import { parseEnv } from "@/config/env";

describe("Environment Configuration & Boundary", () => {
  it("parses valid default environment when variables are undefined", () => {
    const config = parseEnv({
      NODE_ENV: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_APP_NAME: undefined,
    });

    expect(config.NODE_ENV).toBe("development");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Atlas");
  });

  it("handles empty strings by falling back to safe defaults", () => {
    const config = parseEnv({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "",
      NEXT_PUBLIC_APP_NAME: "",
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Atlas");
  });

  it("accepts valid custom URLs with non-standard ports and paths", () => {
    const config = parseEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://medstudy.test:8443/app",
      NEXT_PUBLIC_APP_NAME: "MedStudy Production",
    });

    expect(config.NODE_ENV).toBe("production");
    expect(config.NEXT_PUBLIC_APP_URL).toBe("https://medstudy.test:8443/app");
    expect(config.NEXT_PUBLIC_APP_NAME).toBe("MedStudy Production");
  });

  it("rejects malformed URLs strictly", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "not-a-valid-url",
        NEXT_PUBLIC_APP_NAME: "MedStudy Atlas",
      })
    ).toThrow("Invalid environment configuration");
  });

  it("rejects invalid NODE_ENV values", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "staging" as unknown as undefined,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_NAME: "MedStudy Atlas",
      })
    ).toThrow("Invalid environment configuration");
  });
});
