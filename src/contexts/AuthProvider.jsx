import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./authContext";
import {
  getCurrentSupabaseSession,
  getSupabaseAccessToken,
  logoutSupabaseSession,
  observeSupabaseSession,
  requestEmailOtp,
  verifyEmailOtp,
} from "../services/auth/supabaseAuth";
import { getCurrentOperatorProfile } from "../services/operatorProfileService";
export function AuthProvider({ children }) {
  const [authStatus, setAuthStatus] = useState("loading");
  const [session, setSession] = useState(null);
  const [operatorProfile, setOperatorProfile] = useState(null);
  const [profileStatus, setProfileStatus] = useState("idle");
  const [profileError, setProfileError] = useState("");

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

  useEffect(() => {
    let active = true;

    if (!session?.uid) {
      setOperatorProfile(null);
      setProfileStatus("idle");
      setProfileError("");
      return () => {
        active = false;
      };
    }

    setProfileStatus("loading");
    setProfileError("");

    getCurrentOperatorProfile(session.uid).then((result) => {
      if (!active) return;

      if (!result.ok) {
        setOperatorProfile(null);
        setProfileStatus("error");
        setProfileError(result.message);
        return;
      }

      setOperatorProfile(result.data);
      setProfileStatus("ready");
    });

    return () => {
      active = false;
    };
  }, [session?.uid]);

  const requestOtp = useCallback((email) => requestEmailOtp(email), []);

  const verifyOtp = useCallback(async (email, token) => {
    const nextSession = await verifyEmailOtp(email, token);
    setSession(nextSession);
    setAuthStatus("authenticated");
    return nextSession;
  }, []);

  const logout = useCallback(async () => {
    await logoutSupabaseSession();
    setSession(null);
    setOperatorProfile(null);
    setProfileStatus("idle");
    setProfileError("");
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
      operatorProfile,
      profileStatus,
      profileError,
      requestOtp,
      verifyOtp,
      logout,
      getAccessToken,
    }),
    [
      authStatus,
      session,
      operatorProfile,
      profileStatus,
      profileError,
      requestOtp,
      verifyOtp,
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
