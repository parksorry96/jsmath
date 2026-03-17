import Constants from "expo-constants";
import { Platform } from "react-native";
import { getItemAsync } from "./storage";

function inferExpoHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2
      ?.extra?.expoClient?.hostUri,
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate.split(":")[0];
    }
  }

  return null;
}

function resolvePublicUrl(envValue: string | undefined, port: number, suffix: string) {
  if (envValue) {
    return envValue;
  }

  if (Platform.OS === "web") {
    return `http://localhost:${port}${suffix}`;
  }

  const host = inferExpoHost();
  if (!host) {
    throw new Error(
      "Missing Expo public API URL. Set EXPO_PUBLIC_API_URL or run from Expo with a reachable dev host.",
    );
  }

  return `http://${host}:${port}${suffix}`;
}

export const API_URL = resolvePublicUrl(process.env.EXPO_PUBLIC_API_URL, 3001, "/v1");

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: string }).message)
        : `Request failed with status ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: Platform.OS === "web" ? "include" : undefined,
    headers,
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText };
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete(path: string): Promise<void> {
    return request<void>(path, { method: "DELETE" });
  },
};
