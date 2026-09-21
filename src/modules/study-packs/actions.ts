"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  requestStudyPackGeneration as requestGenerationService,
  getStudyPack as getStudyPackService,
} from "./service";
import type { StudyPackView, StudyPackErrorCode } from "./types";
import { toPublicStudyPackError } from "./errors";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: StudyPackErrorCode;
}

/**
 * Server action to request Study Pack generation for a document.
 * Manual trigger only in Phase 1E (zero automatic AI spend on upload).
 */
export async function requestStudyPackGenerationAction(
  documentId: string
): Promise<ActionResult<{ studyPackId: string; status: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return { success: false, error: "Usuario no autenticado." };
    }

    const result = await requestGenerationService(documentId, user.id);

    revalidatePath("/app/documents");
    revalidatePath(`/app/documents/${documentId}/study-pack`);

    return { success: true, data: result };
  } catch (err: unknown) {
    console.error("requestStudyPackGenerationAction error:", err);
    const publicErr = toPublicStudyPackError(err);
    return {
      success: false,
      error: publicErr.error,
      code: publicErr.code,
    };
  }
}

/**
 * Server action to fetch the current Study Pack for a document.
 */
export async function getStudyPackAction(
  documentId: string
): Promise<ActionResult<StudyPackView | null>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return { success: false, error: "Usuario no autenticado." };
    }

    const result = await getStudyPackService(documentId, user.id);
    return { success: true, data: result };
  } catch (err: unknown) {
    console.error("getStudyPackAction error:", err);
    const publicErr = toPublicStudyPackError(err);
    return {
      success: false,
      error: publicErr.error,
      code: publicErr.code,
    };
  }
}
