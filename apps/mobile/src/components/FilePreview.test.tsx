import { describe, expect, it } from "vitest";

import { createFilePreviewModel } from "./filePreviewModel";

describe("FilePreview", () => {
  it("builds a compact preview model for a changed file", () => {
    const preview = createFilePreviewModel({
      contents: 'export const sample = "preview";',
      language: "ts",
      path: "apps/server/src/auth/http.ts",
    });

    expect(preview.path).toBe("apps/server/src/auth/http.ts");
    expect(preview.language).toBe("ts");
    expect(preview.lines).toContainEqual({
      id: '0:export const sample = "preview";',
      text: 'export const sample = "preview";',
    });
  });
});
