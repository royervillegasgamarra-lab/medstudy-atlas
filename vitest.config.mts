import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Load local env file if available
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if not present
  }
}

import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(process.cwd(), "tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
      "tests/integration/**/*.{test,spec}.{ts,tsx}",
    ],
    env: {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        "sb_publishable_test_dummy_key",
    },
  },
});
