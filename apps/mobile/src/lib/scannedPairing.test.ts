import { describe, expect, it } from "vitest";

import { normalizeScannedPairingUrl } from "./scannedPairing";

describe("normalizeScannedPairingUrl", () => {
  it("accepts a scanned HTTP pairing URL", () => {
    expect(normalizeScannedPairingUrl(" http://100.76.132.28:3773/pair#token=pairing-token ")).toBe(
      "http://100.76.132.28:3773/pair#token=pairing-token",
    );
  });

  it("extracts a nested pairing URL from a t3code-mobile pair deep link", () => {
    expect(
      normalizeScannedPairingUrl(
        "t3code-mobile://pair?url=http%3A%2F%2F100.76.132.28%3A3773%2Fpair%23token%3Dpairing-token",
      ),
    ).toBe("http://100.76.132.28:3773/pair#token=pairing-token");
  });

  it("rejects scanned values that do not contain a pairing URL", () => {
    expect(() => normalizeScannedPairingUrl("not-a-pairing-url")).toThrow(
      "Scan a T3 Code pairing QR code.",
    );
  });
});
