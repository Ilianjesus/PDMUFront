import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../../config/supabaseEnv";

const { url, publishableKey } = getSupabaseConfig();

export const supabase = createClient(url, publishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
