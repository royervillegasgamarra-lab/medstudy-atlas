"use server";

import { revalidatePath } from "next/cache";
import {
  createSubject,
  renameSubject,
  archiveSubject,
  createExamTarget,
  updateExamTarget,
  archiveExamTarget,
} from "./service";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function createSubjectAction(
  formData: FormData
): Promise<ActionResult> {
  const name = formData.get("name")?.toString() || "";
  const result = await createSubject({ name });

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  revalidatePath("/onboarding");
  return { success: true, data: result.data };
}

export async function renameSubjectAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const name = formData.get("name")?.toString() || "";
  const result = await renameSubject(id, { name });

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  return { success: true, data: result.data };
}

export async function archiveSubjectAction(id: string): Promise<ActionResult> {
  const result = await archiveSubject(id);

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  revalidatePath("/onboarding");
  return { success: true, data: result.data };
}

export async function createExamTargetAction(
  formData: FormData
): Promise<ActionResult> {
  const title = formData.get("title")?.toString() || "";
  const exam_date = formData.get("exam_date")?.toString() || "";
  const subject_id = formData.get("subject_id")?.toString() || undefined;

  const result = await createExamTarget({
    title,
    exam_date,
    subject_id,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  revalidatePath("/onboarding");
  return { success: true, data: result.data };
}

export async function updateExamTargetAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const title = formData.get("title")?.toString();
  const exam_date = formData.get("exam_date")?.toString();
  const rawSubjectId = formData.get("subject_id");
  const subject_id =
    rawSubjectId !== null ? rawSubjectId.toString() || null : undefined;

  const result = await updateExamTarget(id, {
    title,
    exam_date,
    subject_id,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  return { success: true, data: result.data };
}

export async function archiveExamTargetAction(
  id: string
): Promise<ActionResult> {
  const result = await archiveExamTarget(id);

  if (result.error) {
    return { success: false, error: result.error };
  }

  revalidatePath("/app");
  return { success: true, data: result.data };
}
