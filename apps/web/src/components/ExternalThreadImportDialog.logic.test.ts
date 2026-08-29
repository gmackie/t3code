import type {
  ExternalThreadImportCandidate,
  ExternalThreadImportOutcome,
  ProviderInstanceRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildImportRows,
  createExternalThreadImportDialogRequestGuard,
  filterImportGroups,
  mergeImportGroups,
  mergeImportPage,
  selectedAvailableTokens,
  openImportedThread,
  retryImportDiscovery,
} from "./ExternalThreadImportDialog.logic";

const provider = (driver: string, instanceId = driver) =>
  ({ driver, instanceId }) as ProviderInstanceRef;

const candidate = (
  token: string,
  input: Partial<ExternalThreadImportCandidate> = {},
): ExternalThreadImportCandidate =>
  ({
    token,
    nativeThreadId: token,
    provider: provider("codex"),
    title: "Fix checkout",
    firstPromptPreview: "Please repair checkout",
    originalCwd: "/repo",
    updatedAt: "2026-08-01T12:00:00.000Z",
    status: { _tag: "Available" },
    ...input,
  }) as ExternalThreadImportCandidate;

describe("external thread import picker logic", () => {
  it("filters provider-grouped candidates by title, preview, path, and provider", () => {
    const groups = [
      {
        _tag: "Success" as const,
        provider: provider("codex"),
        candidates: [candidate("one")],
      },
      {
        _tag: "Success" as const,
        provider: provider("claudeAgent", "claude-work"),
        candidates: [
          candidate("two", {
            provider: provider("claudeAgent", "claude-work"),
            title: "Database migration",
            firstPromptPreview: "Move the accounts table",
            originalCwd: "/services/accounts",
          }),
        ],
      },
    ];

    expect(
      filterImportGroups(groups, "accounts").map((group) => group.provider.instanceId),
    ).toEqual(["claude-work"]);
    const claude = filterImportGroups(groups, "claude")[0];
    const checkout = filterImportGroups(groups, "checkout")[0];
    expect(claude?._tag === "Success" ? claude.candidates : []).toHaveLength(1);
    expect(checkout?._tag === "Success" ? checkout.candidates[0]?.token : undefined).toBe("one");
  });

  it("excludes already-imported rows from the selected import tokens", () => {
    const imported = candidate("old", {
      status: { _tag: "AlreadyImported", threadId: "thread-old" as never },
    });
    expect(selectedAvailableTokens(new Set(["new", "old"]), [candidate("new"), imported])).toEqual([
      "new",
    ]);
  });

  it("keeps partial import outcomes attached to their candidate rows", () => {
    const outcomes = [
      { _tag: "Imported", token: "one", threadId: "thread-one" },
      { _tag: "Failed", token: "two", code: "read_failed", message: "Unreadable history" },
    ] as ExternalThreadImportOutcome[];

    const rows = buildImportRows([candidate("one"), candidate("two")], outcomes);
    expect(rows[0]?.outcome?._tag).toBe("Imported");
    expect(rows[1]?.outcome).toMatchObject({ _tag: "Failed", message: "Unreadable history" });
  });

  it("merges paginated candidates into one provider group", () => {
    const first = {
      _tag: "Success" as const,
      provider: provider("codex"),
      candidates: [candidate("one")],
    };
    const second = {
      _tag: "Success" as const,
      provider: provider("codex"),
      candidates: [candidate("two")],
    };
    const merged = mergeImportGroups([first], [second]);
    expect(merged).toHaveLength(1);
    expect(
      merged[0]?._tag === "Success" ? merged[0].candidates.map((item) => item.token) : [],
    ).toEqual(["one", "two"]);
  });

  it("deduplicates refreshed native threads and migrates their selection to the newest token", () => {
    const old = candidate("old-token", { nativeThreadId: "native-1", title: "Old title" });
    const refreshed = candidate("new-token", {
      nativeThreadId: "native-1",
      title: "New title",
    });

    const result = mergeImportPage(
      [{ _tag: "Success", provider: provider("codex"), candidates: [old] }],
      [{ _tag: "Success", provider: provider("codex"), candidates: [refreshed] }],
      new Set([old.token]),
    );

    const merged = result.groups[0];
    expect(merged?._tag === "Success" ? merged.candidates : []).toEqual([refreshed]);
    expect([...result.selected]).toEqual([refreshed.token]);
  });

  it("retains prior provider candidates and selections when a later page fails", () => {
    const old = candidate("old-token", { nativeThreadId: "native-1" });
    const failure = {
      _tag: "Failure" as const,
      provider: provider("codex"),
      code: "temporarily_unavailable",
      message: "Try again",
      retryable: true,
    };

    const result = mergeImportPage(
      [{ _tag: "Success", provider: provider("codex"), candidates: [old] }],
      [failure],
      new Set([old.token]),
    );

    expect(result.groups.some((group) => group._tag === "Success")).toBe(true);
    expect(result.groups.some((group) => group._tag === "Failure")).toBe(true);
    expect([...result.selected]).toEqual([old.token]);
  });

  it("invalidates stale project completions and prevents duplicate imports", () => {
    const guard = createExternalThreadImportDialogRequestGuard();
    const projectA = guard.activate("env:project-a");
    expect(guard.tryStartImport(projectA, "env:project-a")).toBe(true);
    expect(guard.tryStartImport(projectA, "env:project-a")).toBe(false);

    guard.invalidate();
    const projectB = guard.activate("env:project-b");
    expect(guard.isCurrent(projectA, "env:project-a")).toBe(false);
    expect(guard.finishImport(projectA, "env:project-a")).toBe(false);
    expect(guard.isCurrent(projectB, "env:project-b")).toBe(true);
    expect(guard.tryStartImport(projectB, "env:project-b")).toBe(true);
  });

  it("prevents duplicate pagination requests for the same cursor", () => {
    const guard = createExternalThreadImportDialogRequestGuard();
    const generation = guard.activate("env:project");
    expect(guard.tryStartLoad(generation, "env:project", "cursor-1")).toBe(true);
    expect(guard.tryStartLoad(generation, "env:project", "cursor-1")).toBe(false);
    expect(guard.finishLoad(generation, "env:project", "cursor-1")).toBe(true);
    expect(guard.tryStartLoad(generation, "env:project", "cursor-1")).toBe(true);
  });

  it("closes the picker before opening an imported thread", () => {
    const events: string[] = [];
    openImportedThread({
      environmentId: "env" as never,
      threadId: "thread" as never,
      onClose: () => events.push("close"),
      onOpenThread: () => events.push("open"),
    });
    expect(events).toEqual(["close", "open"]);
  });

  it("retries provider failures through the aggregate pagination cursor", () => {
    const calls: unknown[][] = [];
    const retried = retryImportDiscovery({
      target: { projectId: "project" },
      generation: 7,
      cursor: "aggregate-cursor" as never,
      load: (...args) => {
        calls.push(args);
      },
    });
    expect(retried).toBe(true);
    expect(calls).toEqual([[{ projectId: "project" }, 7, "aggregate-cursor"]]);
  });
});
