import type {
  EnvironmentId,
  ExternalThreadImportCandidate,
  ExternalThreadImportProviderDiscoveryResult,
  ProjectId,
  ProviderInstanceRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildExternalThreadImportShelfRows,
  mergeExternalThreadImportShelfDiscovery,
} from "./ExternalThreadImportShelf.logic";

const provider = (driver: string) => ({ driver, instanceId: driver }) as ProviderInstanceRef;

const candidate = (
  token: string,
  driver: string,
  input: Partial<ExternalThreadImportCandidate> = {},
): ExternalThreadImportCandidate =>
  ({
    token,
    nativeThreadId: token,
    provider: provider(driver),
    title: `${driver} thread`,
    originalCwd: "/repo",
    updatedAt: "2026-08-01T12:00:00.000Z",
    status: { _tag: "Available" },
    ...input,
  }) as ExternalThreadImportCandidate;

const target = (environmentId: string, projectId: string) => ({
  environmentId: environmentId as EnvironmentId,
  projectId: projectId as ProjectId,
});

describe("external thread import shelf logic", () => {
  it("publishes the first discovery page while later pages are still loading", () => {
    const project = target("local", "project-local");
    const first = mergeExternalThreadImportShelfDiscovery([], project, [
      {
        _tag: "Success",
        provider: provider("codex"),
        candidates: [candidate("first-page", "codex")],
      },
    ]);

    expect(buildExternalThreadImportShelfRows(first).map((row) => row.candidate.token)).toEqual([
      "first-page",
    ]);

    const second = mergeExternalThreadImportShelfDiscovery(first, project, [
      {
        _tag: "Success",
        provider: provider("codex"),
        candidates: [candidate("second-page", "codex")],
      },
    ]);
    expect(buildExternalThreadImportShelfRows(second).map((row) => row.candidate.token)).toEqual([
      "first-page",
      "second-page",
    ]);
  });

  it("shows available Claude, Codex, and Grok sessions newest first with their project target", () => {
    const local = target("local", "project-local");
    const remote = target("remote", "project-remote");
    const discoveries: ReadonlyArray<{
      target: typeof local;
      groups: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>;
    }> = [
      {
        target: local,
        groups: [
          {
            _tag: "Success",
            provider: provider("codex"),
            candidates: [candidate("codex-old", "codex")],
          },
          {
            _tag: "Success",
            provider: provider("claudeAgent"),
            candidates: [
              candidate("claude-new", "claudeAgent", {
                updatedAt: "2026-08-02T12:00:00.000Z",
              }),
            ],
          },
        ],
      },
      {
        target: remote,
        groups: [
          {
            _tag: "Success",
            provider: provider("grok"),
            candidates: [candidate("grok-middle", "grok", { title: undefined })],
          },
        ],
      },
    ];

    const rows = buildExternalThreadImportShelfRows(discoveries);

    expect(rows.map((row) => row.candidate.token)).toEqual([
      "claude-new",
      "codex-old",
      "grok-middle",
    ]);
    expect(rows[2]?.target).toEqual(remote);
  });

  it("hides sessions that are already imported and ignores provider failures", () => {
    const project = target("local", "project-local");
    const imported = candidate("already-imported", "codex", {
      status: { _tag: "AlreadyImported", threadId: "thread-existing" as never },
    });

    expect(
      buildExternalThreadImportShelfRows([
        {
          target: project,
          groups: [
            { _tag: "Success", provider: provider("codex"), candidates: [imported] },
            {
              _tag: "Failure",
              provider: provider("claudeAgent"),
              code: "unavailable",
              message: "Claude history unavailable",
              retryable: true,
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
