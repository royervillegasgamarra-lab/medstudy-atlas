import { createClient } from "@/lib/supabase/server";
import { getCalendarDateInLima } from "@/lib/date-utils";
import {
  createSubjectSchema,
  updateSubjectSchema,
  createExamTargetSchema,
  updateExamTargetSchema,
} from "./validation";
import type {
  Subject,
  ExamTargetWithSubject,
  CreateSubjectInput,
  UpdateSubjectInput,
  CreateExamTargetInput,
  UpdateExamTargetInput,
} from "./types";

export interface CurriculumResult<T> {
  data?: T;
  error?: string;
}

/**
 * Retrieves all active (non-archived) subjects for the authenticated user.
 */
export async function getActiveSubjects(): Promise<
  CurriculumResult<Subject[]>
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .is("archived_at", null)
      .order("name", { ascending: true });

    if (error) {
      return { error: "No se pudieron obtener las asignaturas." };
    }

    return { data: (data as Subject[]) || [] };
  } catch {
    return { error: "Error inesperado al cargar asignaturas." };
  }
}

/**
 * Creates a new subject for the authenticated user.
 */
export async function createSubject(
  input: CreateSubjectInput
): Promise<CurriculumResult<Subject>> {
  try {
    const parsed = createSubjectSchema.safeParse(input);
    if (!parsed.success) {
      return {
        error:
          parsed.error.issues[0]?.message || "Datos de asignatura inválidos.",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase
      .from("subjects")
      .insert({
        user_id: user.id,
        name: parsed.data.name,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "Ya tienes una asignatura activa con este nombre." };
      }
      return { error: "No se pudo registrar la asignatura." };
    }

    return { data: data as Subject };
  } catch {
    return { error: "Error inesperado al crear la asignatura." };
  }
}

/**
 * Renames an active subject for the authenticated user.
 */
export async function renameSubject(
  id: string,
  input: UpdateSubjectInput
): Promise<CurriculumResult<Subject>> {
  try {
    const parsed = updateSubjectSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Datos inválidos." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("subjects")
      .update({ name: parsed.data.name })
      .eq("id", id)
      .is("archived_at", null)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "Ya tienes una asignatura activa con este nombre." };
      }
      return { error: "No se pudo actualizar la asignatura." };
    }

    return { data: data as Subject };
  } catch {
    return { error: "Error inesperado al actualizar la asignatura." };
  }
}

/**
 * Archives a subject (soft-delete).
 */
export async function archiveSubject(
  id: string
): Promise<CurriculumResult<boolean>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("subjects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return { error: "No se pudo archivar la asignatura." };
    }

    return { data: true };
  } catch {
    return { error: "Error inesperado al archivar la asignatura." };
  }
}

/**
 * Retrieves all upcoming active exam targets for the authenticated user, sorted by date ascending.
 */
export async function getUpcomingExamTargets(): Promise<
  CurriculumResult<ExamTargetWithSubject[]>
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const todayInLima = getCalendarDateInLima();
    const { data, error } = await supabase
      .from("exam_targets")
      .select("*, subject:subjects(id, name)")
      .is("archived_at", null)
      .gte("exam_date", todayInLima)
      .order("exam_date", { ascending: true });

    if (error) {
      return { error: "No se pudieron obtener los exámenes objetivo." };
    }

    return { data: (data as unknown as ExamTargetWithSubject[]) || [] };
  } catch {
    return { error: "Error inesperado al cargar exámenes." };
  }
}

/**
 * Creates a new exam target for the authenticated user.
 */
export async function createExamTarget(
  input: CreateExamTargetInput
): Promise<CurriculumResult<ExamTargetWithSubject>> {
  try {
    const parsed = createExamTargetSchema.safeParse(input);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message || "Datos del examen inválidos.",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado." };
    }

    const { data, error } = await supabase
      .from("exam_targets")
      .insert({
        user_id: user.id,
        title: parsed.data.title,
        exam_date: parsed.data.exam_date,
        subject_id: parsed.data.subject_id || null,
      })
      .select("*, subject:subjects(id, name)")
      .single();

    if (error) {
      if (error.code === "23503") {
        return {
          error: "La asignatura seleccionada no existe o no te pertenece.",
        };
      }
      return { error: "No se pudo registrar el examen objetivo." };
    }

    return { data: data as unknown as ExamTargetWithSubject };
  } catch {
    return { error: "Error inesperado al crear el examen." };
  }
}

/**
 * Updates an exam target.
 */
export async function updateExamTarget(
  id: string,
  input: UpdateExamTargetInput
): Promise<CurriculumResult<ExamTargetWithSubject>> {
  try {
    const parsed = updateExamTargetSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Datos inválidos." };
    }

    const supabase = await createClient();
    const updatePayload: {
      title?: string;
      exam_date?: string;
      subject_id?: string | null;
    } = {};

    if (parsed.data.title !== undefined)
      updatePayload.title = parsed.data.title;
    if (parsed.data.exam_date !== undefined)
      updatePayload.exam_date = parsed.data.exam_date;
    if (parsed.data.subject_id !== undefined)
      updatePayload.subject_id = parsed.data.subject_id;

    const { data, error } = await supabase
      .from("exam_targets")
      .update(updatePayload)
      .eq("id", id)
      .is("archived_at", null)
      .select("*, subject:subjects(id, name)")
      .single();

    if (error) {
      if (error.code === "23503") {
        return {
          error: "La asignatura seleccionada no existe o no te pertenece.",
        };
      }
      return { error: "No se pudo actualizar el examen." };
    }

    return { data: data as unknown as ExamTargetWithSubject };
  } catch {
    return { error: "Error inesperado al actualizar el examen." };
  }
}

/**
 * Archives an exam target (soft-delete).
 */
export async function archiveExamTarget(
  id: string
): Promise<CurriculumResult<boolean>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("exam_targets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return { error: "No se pudo archivar el examen." };
    }

    return { data: true };
  } catch {
    return { error: "Error inesperado al archivar el examen." };
  }
}
