"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string | null;
  createdAt: string;
}

export type UserRole = "admin" | "teacher" | "student" | "parent";

export function isTeacherPortalRole(role: UserRole): boolean {
  return role === "admin" || role === "teacher";
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    name: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Fetch current user from token on mount
  useEffect(() => {
    api
      .get<User>("/users/me")
      .then(setUser)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post<{ accessToken: string }>(
        "/auth/login",
        { email, password },
      );

      const me = await api.get<User>("/users/me");
      setUser(me);
      router.push("/dashboard");
    },
    [router],
  );

  const register = useCallback(
    async (
      email: string,
      name: string,
      password: string,
    ) => {
      await api.post<{ accessToken: string }>(
        "/auth/register",
        { email, name, password, role: "student" },
      );

      const me = await api.get<User>("/users/me");
      setUser(me);
      router.push("/dashboard");
    },
    [router],
  );

  const logout = useCallback(() => {
    void api.post("/auth/logout").catch(() => undefined);
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
