import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./authContext";
import {
  getCurrentSupabaseSession,
  getSupabaseAccessToken,
  loginWithPassword,
  logoutSupabaseSession,
  observeSupabaseSession,
  requestEmailOtp,
  verifyEmailOtp,
} from "../services/auth/supabaseAuth";

export function AuthProvider({ children }) {
  const [authStatus, setAuthStatus] = useState("loading");
  const [session, setSession] = useState(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = observeSupabaseSession((nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthStatus(nextSession ? "authenticated" : "unauthenticated");
    });

    async function initializeSession() {
      try {
        const currentSession = await getCurrentSupabaseSession();
        if (!active) return;
        setSession(currentSession);
        setAuthStatus(currentSession ? "authenticated" : "unauthenticated");
      } catch (error) {
        if (!active) return;
        console.error("No se pudo recuperar la sesión de Supabase:", error);
        setSession(null);
        setAuthStatus("unauthenticated");
      }
    }

    initializeSession();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const requestOtp = useCallback((email) => requestEmailOtp(email), []);

  const verifyOtp = useCallback(async (email, token) => {
    const nextSession = await verifyEmailOtp(email, token);
    setSession(nextSession);
    setAuthStatus("authenticated");
    return nextSession;
  }, []);

  const loginPassword = useCallback(async (email, password) => {
    const nextSession = await loginWithPassword(email, password);
    setSession(nextSession);
    setAuthStatus("authenticated");
    return nextSession;
  }, []);

  const logout = useCallback(async () => {
    await logoutSupabaseSession();
    setSession(null);
    setAuthStatus("unauthenticated");
  }, []);

  const getAccessToken = useCallback(
    (forceRefresh = false) => getSupabaseAccessToken(forceRefresh),
    []
  );

  const value = useMemo(
    () => ({
      authStatus,
      session,
      requestOtp,
      verifyOtp,
      loginPassword,
      logout,
      getAccessToken,
    }),
    [
      authStatus,
      session,
      requestOtp,
      verifyOtp,
      loginPassword,
      logout,
      getAccessToken,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
