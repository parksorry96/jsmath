import { useState } from "react";
import { getItemAsync } from "../../lib/storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";

export function useCanvasUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (pngBase64: string): Promise<string | null> => {
    setIsUploading(true);
    setError(null);
    try {
      const token = await getItemAsync("auth_token");

      const formData = new FormData();
      formData.append("file", {
        uri: `data:image/png;base64,${pngBase64}`,
        type: "image/png",
        name: "canvas.png",
      } as unknown as Blob);

      const res = await fetch(`${API_URL}/student-ai/canvas/upload`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Let fetch set the multipart boundary automatically.
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(
          typeof body === "object" && body !== null && "message" in body
            ? String(body.message)
            : `Upload failed with status ${res.status}`,
        );
      }

      const data = (await res.json()) as { s3Key: string };
      setS3Key(data.s3Key);
      return data.s3Key;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  return { upload, isUploading, s3Key, error };
}
