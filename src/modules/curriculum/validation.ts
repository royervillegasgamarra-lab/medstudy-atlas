import { z } from "zod";
import { isValidCalendarDate, isFutureOrToday } from "@/lib/date-utils";

export const createSubjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre de la asignatura es obligatorio.")
    .max(120, "El nombre no puede exceder los 120 caracteres."),
});

export const updateSubjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre de la asignatura es obligatorio.")
    .max(120, "El nombre no puede exceder los 120 caracteres."),
});

export const createExamTargetSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "El título del examen es obligatorio.")
    .max(160, "El título no puede exceder los 160 caracteres."),
  exam_date: z
    .string()
    .trim()
    .refine((val) => isValidCalendarDate(val), {
      message: "Formato de fecha inválido. Use YYYY-MM-DD.",
    })
    .refine((val) => isFutureOrToday(val), {
      message: "La fecha del examen debe ser hoy o una fecha futura.",
    }),
  subject_id: z
    .string()
    .trim()
    .uuid("Identificador de asignatura inválido.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});

export const updateExamTargetSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "El título del examen es obligatorio.")
    .max(160, "El título no puede exceder los 160 caracteres.")
    .optional(),
  exam_date: z
    .string()
    .trim()
    .refine((val) => isValidCalendarDate(val), {
      message: "Formato de fecha inválido. Use YYYY-MM-DD.",
    })
    .refine((val) => isFutureOrToday(val), {
      message: "La fecha del examen debe ser hoy o una fecha futura.",
    })
    .optional(),
  subject_id: z
    .string()
    .trim()
    .uuid("Identificador de asignatura inválido.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});
