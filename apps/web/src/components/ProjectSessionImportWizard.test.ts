import type { ExternalThreadImportCandidate } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeExternalThreadImportCandidates } from "./ProjectSessionImportWizard.tsx";

const candidate = (token: string, nativeThreadId: string) =>
  ({
    token,
    nativeThreadId,
    provider: { driver: "claudeAgent", instanceId: "claude" },
  }) as ExternalThreadImportCandidate;

describe("mergeExternalThreadImportCandidates", () => {
  it("replaces a repeated provider thread instead of rendering it twice", () => {
    const original = candidate("old-token", "session-1");
    const refreshed = candidate("new-token", "session-1");

    expect(mergeExternalThreadImportCandidates([original], [refreshed])).toEqual([refreshed]);
  });

  it("keeps one row when discovery returns the same signed token twice", () => {
    const original = candidate("shared-token", "session-1");
    const duplicate = {
      ...candidate("shared-token", "session-2"),
      provider: { driver: "claudeAgent", instanceId: "claude-work" },
    } as ExternalThreadImportCandidate;

    expect(mergeExternalThreadImportCandidates([original], [duplicate])).toEqual([duplicate]);
  });
});
