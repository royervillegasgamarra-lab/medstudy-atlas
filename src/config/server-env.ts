import "server-only";
import { z } from "zod";

/**
 * Server-only environment variable schema definition.
 * Strictly forbidden from being imported into client components or browser bundles.
 * Contains secrets and privileged credentials.
 */
const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z
    .string()
    .trim()
    .min(1, "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required."),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL."),
  AI_GENERATION_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER: z.string().trim().default("mock"),
  AI_MODEL: z.string().trim().default("mock-model"),
  AI_BASE_URL: z.string().trim().optional(),
  AI_API_KEY: z.string().trim().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseServerEnv(): ServerEnv {
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";

  const result = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    AI_GENERATION_ENABLED: process.env.AI_GENERATION_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER || "mock",
    AI_MODEL: process.env.AI_MODEL || "mock-model",
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
  });

  if (!result.success) {
    console.error(
      "Invalid server environment configuration:",
      result.error.format()
    );
    throw new Error(
      "Invalid server environment configuration. SUPABASE_SECRET_KEY is required."
    );
  }

  return result.data;
}

export const serverEnv = parseServerEnv();
