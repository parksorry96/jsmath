import { getItemAsync } from "./storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";
const OCR_URL = process.env.EXPO_PUBLIC_OCR_URL || "http://localhost:8000";

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
  const token = await getItemAsync("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
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
    const token = await getItemAsync("auth_token");
    const formData = new FormData();
    const filename = imageUri.split("/").pop() ?? "photo.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    formData.append("image", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, { method: "POST", body: formData, headers });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = { message: res.statusText }; }
      throw new ApiError(res.status, body);
    }
    return res.json() as Promise<T>;
  },
};
