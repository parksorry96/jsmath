import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { deleteItemAsync, getItemAsync, setItemAsync } from "./storage";

type Role = "student" | "parent" | "teacher" | "admin";

interface User {
  id: string;
  email: string;
  role: Role;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
}

interface AuthResponse {
  accessToken: string;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

function decodeJwtPayload(token: string): JwtPayload {
  const base64 = token.split(".")[1];
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const decoder = globalThis.atob
    ? () => globalThis.atob(padded)
    : () => {
        const buffer = (globalThis as {
          Buffer?: {
            from: (
              input: string,
              encoding: string,
            ) => { toString: (encoding: string) => string };
          };
        }).Buffer;

        if (!buffer) {
          throw new Error("Base64 decoder is not available");
        }

        return buffer.from(padded, "base64").toString("utf8");
      };
  const json = decoder();
  return JSON.parse(json);
}

function userFromToken(token: string): User {
  const payload = decodeJwtPayload(token);
  return { id: payload.sub, email: payload.email, role: payload.role };
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const token = await getItemAsync("auth_token");
      if (token) {
        setUser(userFromToken(token));
      }
    } catch {
      await deleteItemAsync("auth_token");
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>("/auth/login", {
      email,
      password,
    });
    await setItemAsync("auth_token", res.accessToken);
    setUser(userFromToken(res.accessToken));
  }

  async function register(data: RegisterData) {
    const res = await api.post<AuthResponse>("/auth/register", {
      ...data,
      role: "student",
    });
    await setItemAsync("auth_token", res.accessToken);
    setUser(userFromToken(res.accessToken));
  }

  async function logout() {
    await deleteItemAsync("auth_token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
