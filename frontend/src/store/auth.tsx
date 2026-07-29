/** Sessão da interface (PocketBase auth: e-mail + senha). */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { pb, pbError } from "../lib/pb";
import type { User } from "../lib/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>((pb.authStore.record as User | null) ?? null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setUser((pb.authStore.record as User | null) ?? null);
    });

    // revalida a sessão salva no localStorage
    (async () => {
      if (pb.authStore.isValid) {
        try {
          await pb.collection("users").authRefresh();
        } catch {
          pb.authStore.clear();
        }
      }
      setUser((pb.authStore.record as User | null) ?? null);
      setLoading(false);
    })();

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      await pb.collection("users").authWithPassword(email, password);
    } catch (error) {
      throw new Error(pbError(error, "E-mail ou senha inválidos"));
    }
  }, []);

  const logout = useCallback(() => {
    pb.authStore.clear();
  }, []);

  const refresh = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    try {
      await pb.collection("users").authRefresh();
    } catch {
      pb.authStore.clear();
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return context;
}
