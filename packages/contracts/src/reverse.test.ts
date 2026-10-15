import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  ReverseCodeLocation,
  ReverseEvidenceRef,
  ReverseFinding,
  ReverseImportInput,
} from "./reverse.ts";
const digest = "a".repeat(64);
const location = {
  artifactSha256: digest,
  addressSpace: "ram",
  address: "0x08001000",
  architecture: "arm",
  mode: "thumb",
};
describe("reverse contracts", () => {
  it("round-trips an artifact-bound code location", () => {
    expect(Schema.decodeUnknownSync(ReverseCodeLocation)(location)).toEqual(location);
    expect(Schema.decodeUnknownSync(ReverseEvidenceRef)({ kind: "code", location })).toEqual({
      kind: "code",
      location,
    });
  });
  it("rejects unbound and malformed coordinates", () => {
    for (const patch of [
      { artifactSha256: "bad" },
      { addressSpace: "" },
      { address: "0xG" },
      { address: -1 },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(ReverseCodeLocation)({ ...location, ...patch }),
      ).toThrow();
    }
  });
  it("keeps physical and simulated observations distinct", () => {
    for (const source of ["qemu", "physical"]) {
      expect(
        Schema.decodeUnknownSync(ReverseEvidenceRef)({
          kind: "execution",
          source,
          runId: "r1",
          artifactSha256: digest,
        }).kind,
      ).toBe("execution");
    }
    expect(() =>
      Schema.decodeUnknownSync(ReverseEvidenceRef)({
        kind: "execution",
        source: "verified",
        runId: "r1",
        artifactSha256: digest,
      }),
    ).toThrow();
  });
  it("rejects unsafe capture offsets and empty workspace paths", () => {
    for (const startNs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        Schema.decodeUnknownSync(ReverseEvidenceRef)({ kind: "capture", captureId: "c1", startNs }),
      ).toThrow();
    }
    expect(() =>
      Schema.decodeUnknownSync(ReverseImportInput)({ projectId: "p1", relativePath: "" }),
    ).toThrow();
  });
  it("records a gadget candidate without inventing exploitability", () => {
    const result = Schema.decodeUnknownSync(ReverseFinding)({
      id: "g1",
      artifactSha256: digest,
      title: "Return sequence",
      kind: "gadget",
      status: "candidate",
      authorKind: "analyzer",
      evidence: [{ kind: "code", location }],
    });
    expect(result.status).toBe("candidate");
  });
});
