import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { UserProfile, UpdateProfileInput } from "./types";

/**
 * Retrieves the currently authenticated Supabase user from server context.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }
  return user;
}

/**
 * Retrieves the profile of the currently authenticated user.
 * Row Level Security ensures only the user's own profile can be queried.
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as UserProfile;
}

/**
 * Updates the user's profile with validated attributes.
 * Enforces RLS: will fail if attempting to update another user's profile.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const updatePayload: Database["public"]["Tables"]["user_profiles"]["Update"] =
      {};
    if (input.full_name !== undefined) {
      updatePayload.full_name =
        input.full_name && input.full_name.trim().length > 0
          ? input.full_name.trim()
          : null;
    }
    if (input.medical_school !== undefined) {
      updatePayload.medical_school =
        input.medical_school && input.medical_school.trim().length > 0
          ? input.medical_school.trim()
          : null;
    }
    if (input.year_of_study !== undefined) {
      updatePayload.year_of_study = input.year_of_study;
    }

    if (Object.keys(updatePayload).length === 0) {
      return { success: true };
    }

    const { error } = await supabase
      .from("user_profiles")
      .update(updatePayload)
      .eq("id", userId);

    if (error) {
      console.error("[updateProfile error]", error.message);
      return {
        success: false,
        error:
          "No se pudo actualizar el perfil. Por favor verifique los datos ingresados.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[updateProfile exception]", err);
    return {
      success: false,
      error: "Error al actualizar el perfil.",
    };
  }
}

/**
 * Verifies onboarding completion conditions server-side and marks onboarding completed.
 * Rule: Authenticated profile exists AND at least one active (non-archived) subject exists.
 * Enforced at the database level via public.complete_onboarding() RPC.
 * Does not trust arbitrary client assertions.
 */
export async function completeOnboarding(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "No autenticado." };
    }

    const supabase = await createClient();

    // Call database-enforced RPC function which verifies active subjects and stamps completion
    const { error: rpcError } = await supabase.rpc("complete_onboarding");

    if (rpcError) {
      console.error("[completeOnboarding rpc error]", rpcError.message);
      if (rpcError.code === "23514") {
        return {
          success: false,
          error:
            "Debes registrar al menos una asignatura activa para completar el onboarding.",
        };
      }
      return {
        success: false,
        error: "No se pudo registrar la finalización del onboarding.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[completeOnboarding exception]", err);
    return {
      success: false,
      error: "Error inesperado al completar el onboarding.",
    };
  }
}
