function countHangul(text: string): number {
  return (text.match(/[\u3131-\u318e\uac00-\ud7a3]/g) ?? []).length;
}

function countSuspiciousLatin1(text: string): number {
  return (text.match(/[\u0080-\u009f\u00c0-\u00ff]/g) ?? []).length;
}

export function normalizeFilename(filename: string | null | undefined): string | null {
  if (!filename) {
    return null;
  }

  const normalized = filename.normalize("NFC");

  try {
    const repaired = Buffer.from(normalized, "latin1").toString("utf8").normalize("NFC");
    const repairedHangul = countHangul(repaired);
    const originalHangul = countHangul(normalized);
    const suspiciousCount = countSuspiciousLatin1(normalized);

    if (repairedHangul > originalHangul && suspiciousCount >= 2) {
      return repaired;
    }
  } catch {
    // Keep the original normalized filename when repair is not possible.
  }

  return normalized;
}
