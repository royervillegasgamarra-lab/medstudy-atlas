import type { Database } from "@/types/database";

export type UserProfile = Database["public"]["Tables"]["user_profiles"]["Row"];

export type UpdateProfileInput = Partial<
  Pick<
    Database["public"]["Tables"]["user_profiles"]["Update"],
    "full_name" | "medical_school" | "year_of_study"
  >
>;

export interface AuthActionState {
  error?: string | null;
  success?: boolean;
  fieldErrors?: Record<string, string[]>;
}
