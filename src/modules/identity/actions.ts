"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, updateProfile } from "./service";
import type { AuthActionState } from "./types";
import {
  SignupSchema,
  LoginSchema,
  ProfileUpdateSchema,
  getSafeRedirectUrl,
} from "./validation";

export async function signupAction(
  _prevState: AuthActionState | undefined,
  formData: FormData
): Promise<AuthActionState> {
  const parseResult = SignupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    medicalSchool: formData.get("medicalSchool"),
    yearOfStudy: formData.get("yearOfStudy"),
  });

  if (!parseResult.success) {
    return {
      error: "Por favor corrija los errores en el formulario.",
      fieldErrors: parseResult.error.flatten().fieldErrors,
    };
  }

  const { fullName, email, password, medicalSchool, yearOfStudy } =
    parseResult.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          medical_school: medicalSchool,
          year_of_study: yearOfStudy,
        },
      },
    });

    if (error) {
      console.error("[signupAction error]", error.message);
      const msg = error.message.toLowerCase();
      if (
        msg.includes("already registered") ||
        msg.includes("unique") ||
        msg.includes("user already exists")
      ) {
        return {
          error:
            "Este correo electrónico ya está registrado o el registro no está disponible.",
        };
      }
      if (msg.includes("password") || msg.includes("weak")) {
        return {
          error:
            "La contraseña no cumple con los requisitos mínimos de seguridad.",
        };
      }
      return {
        error: "No se pudo crear la cuenta. Por favor intente nuevamente.",
      };
    }

    if (data.session && data.user) {
      // Ensure profile fields are synced if trigger was bypassed or partial
      if (medicalSchool || yearOfStudy) {
        await updateProfile(data.user.id, {
          full_name: fullName,
          medical_school: medicalSchool,
          year_of_study: yearOfStudy,
        });
      }
    }
  } catch (err) {
    console.error("[signupAction exception]", err);
    return {
      error: "Error al registrar la cuenta. Por favor intente nuevamente.",
    };
  }

  redirect("/app");
}

export async function loginAction(
  _prevState: AuthActionState | undefined,
  formData: FormData
): Promise<AuthActionState> {
  const parseResult = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo"),
  });

  if (!parseResult.success) {
    return {
      error: "Correo o contraseña no válidos.",
      fieldErrors: parseResult.error.flatten().fieldErrors,
    };
  }

  const { email, password, redirectTo } = parseResult.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[loginAction error]", error.message);
      return {
        error:
          "Credenciales inválidas. Por favor verifique su correo y contraseña.",
      };
    }
  } catch (err) {
    console.error("[loginAction exception]", err);
    return {
      error: "Error al iniciar sesión. Por favor intente nuevamente.",
    };
  }

  const target = getSafeRedirectUrl(redirectTo);
  redirect(target);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}

export async function updateProfileAction(
  _prevState: AuthActionState | undefined,
  formData: FormData
): Promise<AuthActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: "Sesión expirada o no válida. Por favor inicie sesión nuevamente.",
    };
  }

  const parseResult = ProfileUpdateSchema.safeParse({
    fullName: formData.get("fullName"),
    medicalSchool: formData.get("medicalSchool"),
    yearOfStudy: formData.get("yearOfStudy"),
    targetExamDate: formData.get("targetExamDate"),
  });

  if (!parseResult.success) {
    return {
      error: "Datos de perfil no válidos.",
      fieldErrors: parseResult.error.flatten().fieldErrors,
    };
  }

  const { fullName, medicalSchool, yearOfStudy, targetExamDate } =
    parseResult.data;

  const result = await updateProfile(user.id, {
    full_name: fullName,
    medical_school: medicalSchool,
    year_of_study: yearOfStudy,
    target_exam_date: targetExamDate,
  });

  if (!result.success) {
    return {
      error: result.error || "No se pudo actualizar el perfil.",
    };
  }

  revalidatePath("/app");
  revalidatePath("/app/profile");

  return {
    success: true,
  };
}
