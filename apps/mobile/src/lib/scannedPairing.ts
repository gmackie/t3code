import { parsePairingUrl } from "@t3tools/client-runtime";

export function normalizeScannedPairingUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("Scan a T3 Code pairing QR code.");
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "t3code-mobile:") {
      const nestedPairingUrl = parsed.searchParams.get("url");
      if (!nestedPairingUrl) {
        throw new Error("Scan a T3 Code pairing QR code.");
      }
      parsePairingUrl(nestedPairingUrl);
      return nestedPairingUrl;
    }

    parsePairingUrl(value);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "Scan a T3 Code pairing QR code.") {
      throw error;
    }
    throw new Error("Scan a T3 Code pairing QR code.", { cause: error });
  }
}
