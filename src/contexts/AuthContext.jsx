import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../firebase";
import { setPersistence, browserSessionPersistence } from "firebase/auth";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

setPersistence(auth, browserSessionPersistence);

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // Mientras Firebase verifica

  async function login(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem("isLoggedIn", "true"); // Guardamos flag
    return result;
  }

  async function logout() {
    await signOut(auth);
    localStorage.removeItem("isLoggedIn");
    setUser(null);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = { user, login, logout, loading };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
