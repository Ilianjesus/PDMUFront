import { supabase } from "./supabaseClient";

const GENERIC_OTP_MESSAGE =
  "Si el correo está autorizado, recibirás un código.";

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeOtpToken(token) {
  return token.replace(/[\s-]/g, "").replace(/\D/g, "");
}

function normalizeAuthError(error, fallbackMessage) {
  const normalizedError = new Error(fallbackMessage, { cause: error });
  normalizedError.name = "SupabaseAuthError";
  normalizedError.code = error?.code || "SUPABASE_AUTH_ERROR";
  return normalizedError;
}

export function normalizeSupabaseSession(supabaseSession) {
  const user = supabaseSession?.user;
  if (!user) return null;

  return {
    uid: user.id,
    email: user.email ?? null,
    displayName:
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      null,
    provider: "supabase-otp",
  };
}

export async function getCurrentSupabaseSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw normalizeAuthError(error, "No se pudo recuperar la sesión");
  }

  return normalizeSupabaseSession(data.session);
}

export function observeSupabaseSession(onSessionChange) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, nextSession) => {
    onSessionChange(normalizeSupabaseSession(nextSession));
  });

  return () => subscription.unsubscribe();
}

export async function requestEmailOtp(email) {
  const normalizedEmail = normalizeEmail(email);

  await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false,
    },
  });

  // La UI conserva una respuesta genérica para no revelar si el operador existe.
  // Supabase aplica su propia respuesta y rate limiting en la llamada de red.
  return {
    email: normalizedEmail,
    message: GENERIC_OTP_MESSAGE,
  };
}

export async function verifyEmailOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: normalizeOtpToken(token),
    type: "email",
  });

  if (error || !data.session) {
    throw normalizeAuthError(
      error,
      "El código es inválido o expiró. Solicita uno nuevo."
    );
  }

  return normalizeSupabaseSession(data.session);
}

export async function logoutSupabaseSession() {
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    throw normalizeAuthError(error, "No se pudo cerrar la sesión");
  }
}

export async function getSupabaseAccessToken(forceRefresh = false) {
  if (forceRefresh) {
    const { data: currentData, error: currentError } =
      await supabase.auth.getSession();

    if (currentError) {
      throw normalizeAuthError(currentError, "No se pudo consultar la sesión");
    }

    if (!currentData.session) return null;

    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      throw normalizeAuthError(error, "No se pudo renovar la sesión");
    }

    return data.session?.access_token ?? null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw normalizeAuthError(error, "No se pudo consultar la sesión");
  }

  return data.session?.access_token ?? null;
}
