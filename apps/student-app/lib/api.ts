import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";
import { getItemAsync } from "./storage";

function extractHost(candidate: string) {
  if (!candidate) return null;

  try {
    const normalized = candidate.includes("://")
      ? candidate.replace(/^exp:\/\//, "http://")
      : `http://${candidate}`;
    return new URL(normalized).hostname;
  } catch {
    return candidate.split(":")[0] ?? null;
  }
}

function inferExpoHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2
      ?.extra?.expoClient?.hostUri,
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost,
    (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode?.scriptURL,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      const host = extractHost(candidate);
      if (host) {
        return host;
      }
    }
  }

  return null;
}

function resolvePublicUrl(
  envValue: string | undefined,
  port: number,
  suffix: string,
) {
  if (envValue) {
    return envValue;
  }

  if (Platform.OS === "web") {
    return `http://localhost:${port}${suffix}`;
  }

  const host = inferExpoHost();
  if (host) {
    return `http://${host}:${port}${suffix}`;
  }

  const isIosSimulator =
    Platform.OS === "ios" &&
    Boolean((Constants as { platform?: { ios?: { simulator?: boolean } } }).platform?.ios?.simulator);

  if (isIosSimulator) {
    return `http://localhost:${port}${suffix}`;
  }

  throw new Error(
    "Missing Expo public URL configuration. Set EXPO_PUBLIC_API_URL/EXPO_PUBLIC_OCR_URL or run from Expo with a reachable dev host.",
  );
}

export const API_URL = resolvePublicUrl(process.env.EXPO_PUBLIC_API_URL, 3001, "/v1");
export const OCR_URL = resolvePublicUrl(process.env.EXPO_PUBLIC_OCR_URL, 8000, "");

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    const msg = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: string }).message)
      : `Request failed with status ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}, baseUrl = API_URL): Promise<T> {
  const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: Platform.OS === "web" ? "include" : undefined,
    headers,
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = { message: res.statusText }; }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),

  uploadImage: async <T>(path: string, imageUri: string, baseUrl = OCR_URL): Promise<T> => {
    const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");
    const formData = new FormData();
    const filename = imageUri.split("/").pop() ?? "photo.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    formData.append("image", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      body: formData,
      credentials: Platform.OS === "web" ? "include" : undefined,
      headers,
    });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = { message: res.statusText }; }
      throw new ApiError(res.status, body);
    }
    return res.json() as Promise<T>;
  },
};
