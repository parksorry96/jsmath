import { useState } from "react";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
import { API_URL } from "../../lib/api";
import { getItemAsync } from "../../lib/storage";

export function useCanvasUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (pngBase64: string): Promise<string | null> => {
    setIsUploading(true);
    setError(null);
    try {
      const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");
      const legacyFileSystem = FileSystem as unknown as {
        cacheDirectory?: string;
        writeAsStringAsync?: (
          uri: string,
          contents: string,
          options?: { encoding?: string },
        ) => Promise<void>;
        EncodingType?: { Base64?: string };
      };
      const cacheDirectory = legacyFileSystem.cacheDirectory;
      const writeAsStringAsync = legacyFileSystem.writeAsStringAsync;
      const base64Encoding =
        legacyFileSystem.EncodingType?.Base64 ?? "base64";

      if (!cacheDirectory || !writeAsStringAsync) {
        throw new Error("expo-file-system is not available");
      }

      const tmpPath = `${cacheDirectory}canvas-${Date.now()}.png`;
      await writeAsStringAsync(tmpPath, pngBase64, {
        encoding: base64Encoding,
      });

      const formData = new FormData();
      formData.append("file", {
        uri: tmpPath,
        type: "image/png",
        name: "canvas.png",
      } as any);

      const res = await fetch(`${API_URL}/student-ai/canvas/upload`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Let fetch set the multipart boundary automatically.
        },
        body: formData,
        credentials: Platform.OS === "web" ? "include" : undefined,
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
