import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PrincipalId, RunId, RunSpec, RunStatus, TenantId, type RunView } from "./contracts.ts";
import { RUN_TRANSITIONS, applyRunEvent, decideRun, type RunEventBody } from "./runs.ts";

const tenantId = Schema.decodeSync(TenantId)("local");
const runId = Schema.decodeSync(RunId)("run-1");
const createdBy = {
  tenantId,
  principalId: Schema.decodeSync(PrincipalId)("owner"),
  kind: "human" as const,
};
const spec = Schema.decodeSync(RunSpec)({
  apiVersion: "t3.engine/v1",
  moduleId: "cad",
  moduleVersion: "1.0.0",
  workflowId: "cad.release",
  resourceRefs: [{ namespace: "cad", type: "board", id: "main" }],
  inputArtifactIds: [],
  idempotencyKey: "release-main",
});
const statuses = RunStatus.literals;

const fold = (events: ReadonlyArray<RunEventBody>, from?: RunView) =>
  events.reduce<RunView | undefined>(
    (view, event) => applyRunEvent(view, event, "2026-10-21T10:00:00Z"),
    from,
  );
const created = fold(
  Result.getOrThrow(decideRun(undefined, { type: "run.create", runId, tenantId, spec, createdBy })),
);
const at = (status: RunStatus): RunView => ({ ...created!, status });

describe("decideRun", () => {
  it("creates a run and queues it", () => {
    expect(created).toMatchObject({ runId, status: "queued", revision: 2 });
  });

  it("refuses to create a run that exists", () => {
    const result = decideRun(created, { type: "run.create", runId, tenantId, spec, createdBy });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("allows exactly the transitions in the table", () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const allowed = RUN_TRANSITIONS[from].includes(to);
        const result = decideRun(at(from), { type: "run.transition", to });
        expect(Result.isSuccess(result), `${from} -> ${to}`).toBe(allowed);
      }
    }
  });

  it("cancels only where cancellation is a listed transition", () => {
    expect(Result.isSuccess(decideRun(at("queued"), { type: "run.cancel" }))).toBe(true);
    expect(Result.isFailure(decideRun(at("completed"), { type: "run.cancel" }))).toBe(true);
    expect(Result.isFailure(decideRun(at("outcome-unknown"), { type: "run.cancel" }))).toBe(true);
  });

  it("refuses commands for a run that does not exist", () => {
    expect(Result.isFailure(decideRun(undefined, { type: "run.cancel" }))).toBe(true);
  });
});

describe("applyRunEvent", () => {
  it("clears finishedAt when a failed run is retried", () => {
    const failed = { ...at("failed"), finishedAt: "2026-10-21T09:00:00Z" };
    const events = Result.getOrThrow(decideRun(failed, { type: "run.transition", to: "queued" }));
    expect(fold(events, failed)).not.toHaveProperty("finishedAt");
  });

  it("stamps finishedAt and the error code when a run ends", () => {
    const events = Result.getOrThrow(
      decideRun(at("running"), {
        type: "run.transition",
        to: "failed",
        errorCode: "cad.veritas-down",
      }),
    );
    expect(fold(events, at("running"))).toMatchObject({
      status: "failed",
      finishedAt: "2026-10-21T10:00:00Z",
      lastErrorCode: "cad.veritas-down",
    });
  });
});
