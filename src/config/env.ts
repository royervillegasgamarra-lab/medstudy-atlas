import { z } from "zod";

/**
 * Environment variable schema definition.
 * Enforces strict validation and separation between public (client-safe)
 * and server-only configuration.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .optional()
    .transform((val) =>
      val && val.trim().length > 0 ? val.trim() : "http://localhost:3000"
    )
    .pipe(z.string().url()),
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .optional()
    .transform((val) =>
      val && val.trim().length > 0 ? val.trim() : "MedStudy Atlas"
    ),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .optional()
    .transform((val) =>
      val && val.trim().length > 0 ? val.trim() : "http://127.0.0.1:54321"
    )
    .pipe(z.string().url()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required."),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(customEnv?: Record<string, string | undefined>): Env {
  const source = customEnv ?? {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };

  const result = envSchema.safeParse(source);

  if (!result.success) {
    console.error("Invalid environment configuration:", result.error.format());
    throw new Error(
      "Invalid environment configuration. Check your environment variables."
    );
  }

  return result.data;
}

export const env = parseEnv();
