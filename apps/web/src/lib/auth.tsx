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
import { api, ApiError } from "./api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "teacher" | "student";
  organizationId: string | null;
  createdAt: string;
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
    const token = localStorage.getItem("token");
    if (!token) {
      setIsLoading(false);
      return;
    }

    api
      .get<User>("/users/me")
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("token");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await api.post<{ accessToken: string }>(
        "/auth/login",
        { email, password },
      );
      localStorage.setItem("token", accessToken);

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
      const { accessToken } = await api.post<{ accessToken: string }>(
        "/auth/register",
        { email, name, password, role: "student" },
      );
      localStorage.setItem("token", accessToken);

      const me = await api.get<User>("/users/me");
      setUser(me);
      router.push("/dashboard");
    },
    [router],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
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
