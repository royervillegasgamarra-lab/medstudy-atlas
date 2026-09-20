import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/config/server-env";
import type { Database } from "@/types/database";

let adminClientInstance: SupabaseClient<Database> | null = null;

/**
 * Creates or retrieves the singleton privileged Supabase admin client.
 * Strictly server-only. Uses SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY.
 * Disables session persistence and auto-refresh to prevent credential leakage.
 */
export function getAdminClient(): SupabaseClient<Database> {
  if (!adminClientInstance) {
    adminClientInstance = createClient<Database>(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return adminClientInstance;
}

export const supabaseAdmin = getAdminClient();
