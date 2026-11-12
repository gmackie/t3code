// @effect-diagnostics nodeBuiltinImport:off - This test exercises a dependency-free CI runner script.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { type Lane, type LaneCommand, lanes } from "./pr-lanes.ts";
import {
  type CommandResult,
  defaultConcurrency,
  executeInShell,
  globToRegExp,
  isVitest,
  runLanes,
  runnerFiles,
  selectLanes,
} from "./run-pr-lanes.ts";

const lane = (id: string, paths: Array<string> | undefined, runs: Array<string>): Lane => ({
  id,
  ...(paths ? { paths } : {}),
  commands: runs.map((run) => ({ run })),
});

describe("globToRegExp", () => {
  it("keeps * and ? within a path segment", () => {
    expect(globToRegExp("apps/server/src/cli/pair*").test("apps/server/src/cli/pair.test.ts")).toBe(
      true,
    );
    expect(globToRegExp("apps/server/src/*.ts").test("apps/server/src/cli/pair.ts")).toBe(false);
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("a/.ts")).toBe(false);
  });

  it("lets ** cross segments, including none", () => {
    expect(globToRegExp("packages/engine/**").test("packages/engine/src/a/b.ts")).toBe(true);
    expect(globToRegExp("packages/systems-*/**").test("packages/systems-model/src/x.ts")).toBe(
      true,
    );
    expect(globToRegExp("packages/**/x.ts").test("packages/x.ts")).toBe(true);
    expect(globToRegExp("T3CODE-41-**").test("T3CODE-41-a/b")).toBe(true);
    expect(globToRegExp("T3CODE-*").test("T3CODE-41-a/b")).toBe(false);
  });

  it("matches dots literally", () => {
    expect(globToRegExp("pnpm-lock.yaml").test("pnpm-lockxyaml")).toBe(false);
  });
});

describe("selectLanes", () => {
  const always = lane("always", undefined, ["true"]);
  const server = lane("server", ["apps/server/**"], ["true"]);
  const stacked: Lane = {
    ...lane("stacked", ["apps/web/**"], ["true"]),
    branches: ["custom-local", "T3CODE-*"],
  };

  it("runs path-free lanes always and path lanes only when a file matches", () => {
    const selected = selectLanes([always, server, stacked], "custom-local", [
      "apps/server/src/a.ts",
    ]);
    expect(selected.lanes.map((l) => l.id)).toEqual(["always", "server"]);
  });

  it("keeps a lane to its base branches", () => {
    const selected = selectLanes([always, server, stacked], "T3CODE-27", [
      "apps/web/a.ts",
      "apps/server/a.ts",
    ]);
    expect(selected.lanes.map((l) => l.id)).toEqual(["stacked"]);
  });

  it("runs every lane for the branch when the changes are unknown or the runner changed", () => {
    expect(selectLanes([always, server, stacked], "custom-local", undefined).lanes).toHaveLength(3);
    for (const file of runnerFiles) {
      expect(selectLanes([always, server, stacked], "custom-local", [file]).lanes).toHaveLength(3);
    }
  });
});

describe("the configured lanes", () => {
  it("have unique ids and keep lane-check on every pull request", () => {
    expect(new Set(lanes.map((l) => l.id)).size).toBe(lanes.length);
    const selected = selectLanes(lanes, "custom-local", ["README.md"]);
    expect(selected.lanes.map((l) => l.id)).toEqual(["lane-check"]);
  });

  it("only name working directories that exist", () => {
    const root = NodePath.resolve(import.meta.dirname, "..");
    const cwds = new Set(lanes.flatMap((l) => l.commands.map((c) => c.cwd ?? ".")));
    for (const cwd of cwds) expect(NodeFS.existsSync(NodePath.join(root, cwd)), cwd).toBe(true);
  });

  it("select the lanes a lockfile change used to start", () => {
    const selected = selectLanes(lanes, "custom-local", ["pnpm-lock.yaml"]).lanes.map((l) => l.id);
    expect(selected).toContain("forgegraph-provider/server-typecheck");
    expect(selected).toContain("systems-model/systems");
    expect(selected).not.toContain("engine");
  });
});

describe("runLanes", () => {
  const pass = (): CommandResult => ({ outcome: "pass", seconds: 0, output: "" });
  // Lets the other lanes' commands start while this one is still running.
  const yieldTurns = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  };

  it("runs a command shared by several lanes once", async () => {
    const calls: Array<string> = [];
    const results = await runLanes(
      [lane("a", undefined, ["tsc", "a"]), lane("b", undefined, ["tsc", "b"])],
      {
        concurrency: 2,
        execute: async (command) => {
          calls.push(command.run);
          return pass();
        },
      },
    );
    expect(calls.toSorted()).toEqual(["a", "b", "tsc"]);
    expect(results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
  });

  it("stops a lane at its first failure and fails every lane sharing that command", async () => {
    const calls: Array<string> = [];
    const results = await runLanes(
      [
        lane("a", undefined, ["broken", "after"]),
        lane("b", undefined, ["broken"]),
        lane("c", undefined, ["fine"]),
      ],
      {
        concurrency: 2,
        execute: async (command) => {
          calls.push(command.run);
          return command.run === "broken" ? { outcome: "FAIL", seconds: 0, output: "" } : pass();
        },
      },
    );
    expect(calls).not.toContain("after");
    expect(results.map((r) => [r.lane.id, r.outcome, r.failed?.run])).toEqual([
      ["a", "FAIL", "broken"],
      ["b", "FAIL", "broken"],
      ["c", "pass", undefined],
    ]);
  });

  it("keeps vitest runs one at a time and runs exclusive commands alone", async () => {
    let running = 0;
    let vitestRunning = 0;
    const seen: Array<{ run: string; running: number; vitest: number }> = [];
    const exclusive: LaneCommand = { run: "bench", exclusive: true };
    await runLanes(
      [
        lane("a", undefined, ["pnpm exec vp test run a", "tsc a"]),
        lane("b", undefined, ["pnpm exec vp test run b", "tsc b"]),
        { id: "c", commands: [{ run: "lint" }, exclusive] },
      ],
      {
        concurrency: 3,
        execute: async (command) => {
          running++;
          if (isVitest(command)) vitestRunning++;
          seen.push({ run: command.run, running, vitest: vitestRunning });
          await yieldTurns();
          running--;
          if (isVitest(command)) vitestRunning--;
          return pass();
        },
      },
    );
    expect(Math.max(...seen.map((s) => s.vitest))).toBe(1);
    expect(seen.find((s) => s.run === "bench")?.running).toBe(1);
  });
});

describe("executeInShell", () => {
  it("runs in the command's cwd with errexit and reports failures", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pr-lanes-"));
    NodeFS.mkdirSync(NodePath.join(root, "sub"));
    const execute = executeInShell(root);

    const ok = await execute({ cwd: "sub", run: 'basename "$PWD"' });
    expect(ok.outcome).toBe("pass");
    expect(ok.output.trim()).toBe("sub");

    const failed = await execute({ run: "false\necho unreachable" });
    expect(failed.outcome).toBe("FAIL");
    expect(failed.output).not.toContain("unreachable");
  });
});

describe("defaultConcurrency", () => {
  it("allows one command per two CPUs and per 3 GiB, between 1 and 4", () => {
    expect(defaultConcurrency(6, 6 * 1024 ** 3)).toBe(2);
    expect(defaultConcurrency(1, 1024 ** 3)).toBe(1);
    expect(defaultConcurrency(32, 128 * 1024 ** 3)).toBe(4);
  });
});
