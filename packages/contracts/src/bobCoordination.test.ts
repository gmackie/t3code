import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { bobOperationSchemas, BobExecutionRequest } from "./bobContract.ts";
import { planBelongsToProject } from "./bobCoordination.ts";

const target = {
  environmentId: "mini",
  projectId: "project",
  repository: { integrationId: "forgegraph", repositoryId: "repo" },
};
const issueProject = {
  integrationId: "kanbanger",
  workspaceId: "workspace",
  teamId: "team",
  projectId: "issues",
};
const item = {
  itemId: "item",
  target,
  issue: { ...issueProject, issueId: "issue" },
  issueSnapshotRef: "scope",
  completionTarget: "production" as const,
};
const request = {
  contractVersion: "1",
  requestId: "request",
  attemptId: "attempt",
  itemId: "item",
  planId: "plan",
  planVersion: 1,
  issueSnapshotRef: "scope",
  target,
  work: { title: "Work", instructions: "Implement", acceptanceCriteria: ["Tests pass"] },
  workspace: { baseRevision: "a".repeat(40), branch: "T3CODE-6-test" },
  executionProfileId: "cliapiproxy",
};
describe("ForgeC Bob contract", () => {
  it("validates admission identifiers, immutable source and rejects extra authority fields", () => {
    const decode = Schema.decodeUnknownSync(BobExecutionRequest, { onExcessProperty: "error" });
    expect(decode(request)).toEqual(request);
    expect(() => decode({ ...request, actor: "admin" })).toThrow();
    expect(() =>
      decode({ ...request, workspace: { ...request.workspace, baseRevision: "main" } }),
    ).toThrow();
    expect(() => decode({ ...request, contractVersion: "2" })).toThrow();
    expect(() =>
      decode({ ...request, work: { ...request.work, acceptanceCriteria: [] } }),
    ).toThrow();
  });
  it("does not expose mixed target or issue-project plans as caller-project work", () => {
    const plan = { items: [item], dependencies: [], concurrencyLimit: 1 };
    const binding = { target, issueProject };
    expect(planBelongsToProject(plan, binding)).toBe(true);
    expect(
      planBelongsToProject(
        { ...plan, items: [item, { ...item, target: { ...target, environmentId: "bob" } }] },
        binding,
      ),
    ).toBe(false);
    expect(
      planBelongsToProject(
        { ...plan, items: [{ ...item, issue: { ...item.issue, workspaceId: "other" } }] },
        binding,
      ),
    ).toBe(false);
    expect(planBelongsToProject({ ...plan, items: [] }, binding)).toBe(false);
  });
  it("loads every compiler operation schema and preserves receipt digest constraints", () => {
    expect(bobOperationSchemas.size).toBe(24);
    const receipt = {
      contractVersion: "1",
      eventId: "event",
      environmentId: "mini",
      executionId: "execution",
      attemptId: "attempt",
      sequence: 1,
      occurredAt: "2026-10-10T00:00:00.000Z",
      outcome: "succeeded",
      thread: { environmentId: "mini", projectId: "project", threadId: "thread" },
      sourceSnapshot: {
        repository: target.repository,
        commitSha: "a".repeat(40),
        treeDigest: "b".repeat(64),
        dirty: false,
      },
      evidenceRefs: [],
    };
    const decode = Schema.decodeUnknownSync(
      bobOperationSchemas.get("RecordExecutionReceipt")!.input,
    );
    expect(decode(receipt)).toEqual(receipt);
    expect(() =>
      decode({
        ...receipt,
        sourceSnapshot: { ...receipt.sourceSnapshot, treeDigest: "b".repeat(40) },
      }),
    ).toThrow();
  });
});
