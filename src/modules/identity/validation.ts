import { z } from "zod";

/**
 * Validates and sanitizes redirect URLs to prevent Open Redirect vulnerabilities (CWE-601).
 * Rejects protocol-relative URLs (e.g., //attacker.com) and backslash bypasses.
 */
export function getSafeRedirectUrl(url?: string | null): string {
  if (!url) return "/app";
  const trimmed = url.trim();
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\")
  ) {
    return trimmed;
  }
  return "/app";
}

export const SignupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres."),
  email: z.string().trim().email("Correo electrónico inválido.").toLowerCase(),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
  medicalSchool: z
    .string()
    .max(150, "El nombre de la facultad no puede exceder 150 caracteres.")
    .nullable()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : null)),
  yearOfStudy: z
    .union([
      z.coerce.number().int().min(1).max(10),
      z.literal(""),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((val) => (typeof val === "number" ? val : null)),
});

export const LoginSchema = z.object({
  email: z.string().trim().email("Correo electrónico inválido.").toLowerCase(),
  password: z.string().min(1, "Ingrese su contraseña."),
  redirectTo: z.string().optional(),
});

export const ProfileUpdateSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres."),
  medicalSchool: z
    .string()
    .max(150, "El nombre de la facultad no puede exceder 150 caracteres.")
    .nullable()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : null)),
  yearOfStudy: z
    .union([
      z.coerce.number().int().min(1).max(10),
      z.literal(""),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((val) => (typeof val === "number" ? val : null)),
});

export const AcademicProfileSchema = z.object({
  medicalSchool: z
    .string()
    .max(150, "El nombre de la facultad no puede exceder 150 caracteres.")
    .nullable()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : null)),
  yearOfStudy: z
    .union([
      z.coerce.number().int().min(1).max(10),
      z.literal(""),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((val) => (typeof val === "number" ? val : null)),
});
