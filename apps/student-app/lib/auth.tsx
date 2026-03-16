import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  socialLogin: (provider: "kakao" | "apple" | "google", token: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface SocialAuthResponse {
  accessToken: string;
  isNewUser: boolean;
}

function decodeJwtPayload(token: string): { sub: string; email: string; role: string } {
  const base64 = token.split(".")[1];
  const json = atob(base64);
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
        const token = await getItemAsync("auth_token");
        if (token) setUser(userFromToken(token));
      } catch { await deleteItemAsync("auth_token"); }
      finally { setIsLoading(false); }
    })();
  }, []);

  async function socialLogin(provider: "kakao" | "apple" | "google", token: string) {
    const res = await api.post<SocialAuthResponse>("/auth/social", { provider, token });
    await setItemAsync("auth_token", res.accessToken);
    setUser(userFromToken(res.accessToken));
    setIsNewUser(res.isNewUser);
  }

  async function logout() {
    await deleteItemAsync("auth_token");
    setUser(null);
    setIsNewUser(false);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isNewUser, socialLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
