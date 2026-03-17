import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { api } from "./api";
import { deleteItemAsync, getItemAsync, setItemAsync } from "./storage";

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isNewUser: boolean;
  login: (email: string, password: string) => Promise<void>;
  completeOnboarding: () => void;
  socialLogin: (provider: "kakao" | "apple" | "google", token: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface SocialAuthResponse {
  accessToken: string;
  isNewUser: boolean;
}

function decodeJwtPayload(token: string): { sub: string; email: string; role: string } {
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
  const p = decodeJwtPayload(token);
  return { id: p.sub, email: p.email, role: p.role };
}

const AuthContext = createContext<AuthContextType>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web") {
          const me = await api.get<User>("/users/me").catch(() => null);
          if (me) {
            setUser(me);
          }
        } else {
          const token = await getItemAsync("auth_token");
          if (token) setUser(userFromToken(token));
        }
      } catch { await deleteItemAsync("auth_token"); }
      finally { setIsLoading(false); }
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string }>("/auth/login", { email, password });
    if (Platform.OS === "web") {
      const me = await api.get<User>("/users/me");
      setUser(me);
    } else {
      await setItemAsync("auth_token", res.accessToken);
      setUser(userFromToken(res.accessToken));
    }
    setIsNewUser(false);
  }

  async function socialLogin(provider: "kakao" | "apple" | "google", token: string) {
    const res = await api.post<SocialAuthResponse>("/auth/social", {
      provider,
      accessToken: token,
    });
    if (Platform.OS === "web") {
      const me = await api.get<User>("/users/me");
      setUser(me);
    } else {
      await setItemAsync("auth_token", res.accessToken);
      setUser(userFromToken(res.accessToken));
    }
    setIsNewUser(res.isNewUser);
  }

  function completeOnboarding() {
    setIsNewUser(false);
  }

  async function logout() {
    if (Platform.OS === "web") {
      await api.post("/auth/logout").catch(() => undefined);
    }
    await deleteItemAsync("auth_token");
    setUser(null);
    setIsNewUser(false);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isNewUser,
        login,
        completeOnboarding,
        socialLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
