import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn utility", () => {
  it("merges class names correctly", () => {
    expect(cn("px-2 py-1", "bg-primary")).toBe("px-2 py-1 bg-primary");
  });

  it("handles conditional classes", () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn("base", isTrue && "active", isFalse && "inactive")).toBe(
      "base active"
    );
  });

  it("handles empty or falsy values gracefully", () => {
    expect(cn("base", null, undefined, false, "")).toBe("base");
  });

  it("resolves conflicting Tailwind utility classes correctly", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("px-4 py-2", "p-6")).toBe("p-6");
  });
});
