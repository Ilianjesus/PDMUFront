const supabaseConfig = Object.freeze({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export class SupabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupabaseConfigError";
    this.code = "SUPABASE_CONFIG_ERROR";
  }
}

export function getSupabaseConfig() {
  if (!supabaseConfig.url) {
    throw new SupabaseConfigError(
      "Falta configurar VITE_SUPABASE_URL"
    );
  }

  if (!supabaseConfig.publishableKey) {
    throw new SupabaseConfigError(
      "Falta configurar VITE_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  try {
    const parsedUrl = new URL(supabaseConfig.url);
    if (parsedUrl.protocol !== "https:") throw new Error();
  } catch {
    throw new SupabaseConfigError(
      "VITE_SUPABASE_URL debe ser una URL HTTPS válida"
    );
  }

  if (!supabaseConfig.publishableKey.startsWith("sb_publishable_")) {
    throw new SupabaseConfigError(
      "VITE_SUPABASE_PUBLISHABLE_KEY no tiene formato de publishable key"
    );
  }

  return supabaseConfig;
}
