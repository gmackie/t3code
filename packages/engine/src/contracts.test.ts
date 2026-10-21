import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { EngineError, RunSpec, RunView, operationKey } from "./contracts.ts";

const decodeSpec = Schema.decodeUnknownSync(RunSpec);
const decodeView = Schema.decodeUnknownSync(RunView);
const decodeError = Schema.decodeUnknownSync(EngineError);

const cadRelease = {
  apiVersion: "t3.engine/v1",
  moduleId: "cad",
  moduleVersion: "1.0.0",
  workflowId: "cad.release",
  resourceRefs: [{ namespace: "cad", type: "board", id: "veritas-main", revision: "r7" }],
  inputArtifactIds: ["bom-snapshot-1"],
  idempotencyKey: "release-veritas-main-r7",
};

const bookingComparison = {
  apiVersion: "t3.engine/v1",
  moduleId: "travel",
  moduleVersion: "0.3.0",
  workflowId: "travel.booking.compare",
  resourceRefs: [
    { namespace: "travel", type: "itinerary", id: "trip-42" },
    { namespace: "travel", type: "quote", id: "q-9", revision: "2026-10-21T10:00:00Z" },
  ],
  inputArtifactIds: [],
  idempotencyKey: "compare-trip-42",
  requestedBudget: { maxUsd: 0.5, deadlineMs: 60_000 },
};

describe("RunSpec", () => {
  it("describes unrelated domains with one contract", () => {
    expect(decodeSpec(cadRelease).resourceRefs[0]?.type).toBe("board");
    expect(decodeSpec(bookingComparison).resourceRefs).toHaveLength(2);
  });

  it("drops client-supplied identity so the server must bind it", () => {
    const decoded = decodeSpec({
      ...cadRelease,
      tenantId: "someone-else",
      createdBy: { tenantId: "someone-else", principalId: "admin", kind: "human" },
    });
    expect(decoded).not.toHaveProperty("tenantId");
    expect(decoded).not.toHaveProperty("createdBy");
  });

  it.each([
    ["blank idempotency key", { ...cadRelease, idempotencyKey: " " }],
    [
      "padded resource id",
      { ...cadRelease, resourceRefs: [{ namespace: "cad", type: "board", id: " x" }] },
    ],
    ["uppercase module", { ...cadRelease, moduleId: "CAD" }],
    [
      "path-shaped namespace",
      { ...cadRelease, resourceRefs: [{ namespace: "../cad", type: "board", id: "x" }] },
    ],
    ["unknown api version", { ...cadRelease, apiVersion: "t3.engine/v2" }],
    ["negative budget", { ...bookingComparison, requestedBudget: { maxUsd: -1 } }],
  ])("rejects %s", (_label, input) => {
    expect(() => decodeSpec(input)).toThrow();
  });
});

describe("RunView", () => {
  const view = {
    runId: "run-1",
    tenantId: "local",
    status: "outcome-unknown",
    revision: 3,
    createdBy: { tenantId: "local", principalId: "owner", kind: "human" },
    spec: cadRelease,
    createdAt: "2026-10-21T10:00:00Z",
    updatedAt: "2026-10-21T10:05:00Z",
  };

  it("keeps an unverified external outcome distinct from success", () => {
    expect(decodeView(view).status).toBe("outcome-unknown");
  });

  it("rejects statuses outside the state machine", () => {
    expect(() => decodeView({ ...view, status: "succeeded" })).toThrow();
  });
});

describe("EngineError", () => {
  it("decodes each failure by tag", () => {
    expect(
      decodeError({
        _tag: "EngineRevisionConflict",
        streamId: "run-1",
        expectedVersion: 2,
        actualVersion: 3,
      })._tag,
    ).toBe("EngineRevisionConflict");
    expect(() =>
      decodeError({ _tag: "EngineAuthorizationDenied", publicReasonCode: "No Grant" }),
    ).toThrow();
  });
});

describe("operationKey", () => {
  it("joins id and version into the registry key", () => {
    expect(operationKey({ id: "cad.release.commit", version: 1 })).toBe("cad.release.commit@1");
  });
});
