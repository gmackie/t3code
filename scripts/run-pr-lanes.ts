// @effect-diagnostics nodeBuiltinImport:off - a dependency-free CI runner: it spawns shells and reads cgroup limits.
// Runs the pull request CI lanes in scripts/pr-lanes.ts from one checkout and
// one install (.forgejo/workflows/pr-lanes.yml, T3CODE-100).
//
//   node scripts/run-pr-lanes.ts                        lanes for the pull request in the workflow event
//   node scripts/run-pr-lanes.ts --all                  every lane
//   node scripts/run-pr-lanes.ts --lanes pair,engine    these lanes
//   node scripts/run-pr-lanes.ts --files a.ts,b.ts --base custom-local   lanes these changed files select
//   node scripts/run-pr-lanes.ts --list                 print the plan and run nothing
//
// The changed files come from the Forgejo API (the same merge-base diff that a
// workflow's `paths:` filter reads). When they cannot be read, every lane runs.
//
// Commands run side by side within a budget sized from the job container's
// CPU and memory limits (PR_LANES_CONCURRENCY overrides it). Vitest runs take
// turns, as in check-changed: runs started together race to rebuild
// node_modules/.vitest-cache. A command with the same cwd and text in several
// lanes runs once. Each command's output prints when it finishes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { type Lane, type LaneCommand, lanes as configuredLanes } from "./pr-lanes.ts";

// Editing any of these can change what a lane runs, so it runs every lane.
export const runnerFiles = [
  ".forgejo/workflows/pr-lanes.yml",
  "scripts/pr-lanes.ts",
  "scripts/run-pr-lanes.ts",
];

const defaultBranches = ["custom-local"];

// Workflow `paths:` and `branches:` glob syntax: `*` and `?` stay within one
// path segment, `**` crosses segments.
export const globToRegExp = (glob: string): RegExp => {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index++;
        if (glob[index + 1] === "/") {
          index++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
};

const matchesAny = (value: string, globs: ReadonlyArray<string>) =>
  globs.some((glob) => globToRegExp(glob).test(value));

export interface Selection {
  readonly lanes: ReadonlyArray<Lane>;
  readonly reason: string;
}

// The lanes a pull request into `baseBranch` runs. `changedFiles` undefined
// means the changes are unknown, so every lane for the branch runs.
export const selectLanes = (
  lanes: ReadonlyArray<Lane>,
  baseBranch: string,
  changedFiles: ReadonlyArray<string> | undefined,
): Selection => {
  const forBranch = lanes.filter((lane) =>
    matchesAny(baseBranch, lane.branches ?? defaultBranches),
  );
  if (changedFiles === undefined) {
    return { lanes: forBranch, reason: "changed files unknown: every lane runs" };
  }
  const runner = changedFiles.find((file) => runnerFiles.includes(file));
  if (runner !== undefined) {
    return { lanes: forBranch, reason: `${runner} changed: every lane runs` };
  }
  return {
    lanes: forBranch.filter(
      (lane) =>
        lane.paths === undefined || changedFiles.some((file) => matchesAny(file, lane.paths ?? [])),
    ),
    reason: `${changedFiles.length} changed file(s)`,
  };
};

export const commandKey = (command: LaneCommand) => `${command.cwd ?? "."}\u0000${command.run}`;

export const isVitest = (command: LaneCommand) => /\bvp test\b|\bvitest\b/.test(command.run);

export const commandLabel = (command: LaneCommand) => {
  const firstLine = command.run.split("\n").find((line) => line.trim() !== "") ?? command.run;
  const text = firstLine.length > 110 ? `${firstLine.slice(0, 107)}...` : firstLine;
  return command.cwd ? `(${command.cwd}) ${text}` : text;
};

// One step per two CPUs and per 3 GiB of memory, from the container's cgroup
// limits when it has them.
export const defaultConcurrency = (cpus: number, memoryBytes: number) =>
  Math.max(1, Math.min(4, Math.floor(cpus / 2), Math.floor(memoryBytes / (3 * 1024 ** 3))));

const readCgroup = (file: string) => {
  try {
    return NodeFS.readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
};

const containerLimits = () => {
  let cpus = NodeOS.availableParallelism();
  const cpuMax = readCgroup("/sys/fs/cgroup/cpu.max")?.split(" ");
  if (cpuMax && cpuMax[0] !== "max") {
    cpus = Math.min(cpus, Number(cpuMax[0]) / Number(cpuMax[1]));
  }
  let memory = NodeOS.totalmem();
  const memoryMax = readCgroup("/sys/fs/cgroup/memory.max");
  if (memoryMax && memoryMax !== "max") {
    memory = Math.min(memory, Number(memoryMax));
  }
  return { cpus, memory };
};

// A FIFO budget: a request waits behind earlier ones, so an exclusive command
// that needs every slot is not starved by later small ones.
export class Budget {
  readonly #size: number;
  #free: number;
  readonly #waiters: Array<{ readonly slots: number; readonly resume: () => void }> = [];

  constructor(size: number) {
    this.#size = size;
    this.#free = size;
  }

  async use<A>(slots: number, task: () => Promise<A>): Promise<A> {
    const wanted = Math.min(slots, this.#size);
    if (this.#waiters.length > 0 || this.#free < wanted) {
      await new Promise<void>((resume) => this.#waiters.push({ slots: wanted, resume }));
    } else {
      this.#free -= wanted;
    }
    try {
      return await task();
    } finally {
      this.#free += wanted;
      while (this.#waiters.length > 0 && this.#free >= (this.#waiters[0]?.slots ?? 0)) {
        const next = this.#waiters.shift();
        if (next) {
          this.#free -= next.slots;
          next.resume();
        }
      }
    }
  }
}

export type Outcome = "pass" | "FAIL" | "TIMEOUT";

export interface CommandResult {
  readonly outcome: Outcome;
  readonly seconds: number;
  readonly output: string;
}

export type Execute = (command: LaneCommand) => Promise<CommandResult>;

export interface LaneResult {
  readonly lane: Lane;
  readonly outcome: Outcome | "skipped";
  readonly failed?: LaneCommand;
  readonly seconds: number;
}

// Runs the lanes' commands in lane order, each lane stopping at its first
// failure, sharing identical commands and the budget across lanes.
export const runLanes = async (
  lanes: ReadonlyArray<Lane>,
  options: {
    readonly concurrency: number;
    readonly execute: Execute;
    readonly onResult?: (command: LaneCommand, result: CommandResult, lanes: string) => void;
  },
): Promise<ReadonlyArray<LaneResult>> => {
  const budget = new Budget(options.concurrency);
  const vitest = new Budget(1);
  const shared = new Map<string, Promise<CommandResult>>();
  const users = new Map<string, Array<string>>();
  for (const lane of lanes) {
    for (const command of lane.commands) {
      const key = commandKey(command);
      users.set(key, [...(users.get(key) ?? []), lane.id]);
    }
  }

  const run = (command: LaneCommand) => {
    const key = commandKey(command);
    let result = shared.get(key);
    if (result === undefined) {
      const slots = command.exclusive ? options.concurrency : 1;
      const execute = () => budget.use(slots, () => options.execute(command));
      result = (isVitest(command) ? vitest.use(1, execute) : execute()).then((done) => {
        options.onResult?.(command, done, (users.get(key) ?? []).join(", "));
        return done;
      });
      shared.set(key, result);
    }
    return result;
  };

  return Promise.all(
    lanes.map(async (lane): Promise<LaneResult> => {
      let seconds = 0;
      for (const command of lane.commands) {
        const result = await run(command);
        seconds += result.seconds;
        if (result.outcome !== "pass") {
          return { lane, outcome: result.outcome, failed: command, seconds };
        }
      }
      return { lane, outcome: "pass", seconds };
    }),
  );
};

const commandTimeoutSeconds = () => Number(process.env.PR_LANES_COMMAND_TIMEOUT_SECONDS ?? 1800);

// Runs one command in bash -e from the repository root, killing its whole
// process group at the timeout so pnpm and vitest children do not outlive it.
export const executeInShell =
  (root: string): Execute =>
  (command) =>
    new Promise((resolve) => {
      const started = Date.now();
      const chunks: Array<Buffer> = [];
      const child = NodeChildProcess.spawn(
        "bash",
        ["--noprofile", "--norc", "-e", "-c", command.run],
        {
          cwd: NodePath.join(root, command.cwd ?? "."),
          detached: true,
          env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, signal);
        } catch {
          // The group is already gone.
        }
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        signalGroup("SIGTERM");
        setTimeout(() => signalGroup("SIGKILL"), 15_000).unref();
      }, commandTimeoutSeconds() * 1000);
      child.on("error", (error) => chunks.push(Buffer.from(`\n${error.message}\n`)));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          outcome: timedOut ? "TIMEOUT" : code === 0 ? "pass" : "FAIL",
          seconds: Math.round((Date.now() - started) / 1000),
          output: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

const printResult = (command: LaneCommand, result: CommandResult, laneIds: string) => {
  const mark = result.outcome === "pass" ? "ok" : result.outcome;
  const title = `${mark} ${commandLabel(command)} (${result.seconds}s) [${laneIds}]`;
  if (result.outcome === "pass") {
    console.log(`::group::${title}`);
    process.stdout.write(result.output);
    console.log("::endgroup::");
  } else {
    console.log(title);
    process.stdout.write(result.output);
    const reason = result.outcome === "TIMEOUT" ? `ran past ${commandTimeoutSeconds()}s` : "failed";
    console.log(`::error title=${laneIds}::${commandLabel(command)} ${reason}`);
  }
};

const changedFilesFromForgejo = async (): Promise<ReadonlyArray<string> | undefined> => {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!server || !repository || !token || !eventPath) return undefined;
  let number: number | undefined;
  try {
    number = JSON.parse(NodeFS.readFileSync(eventPath, "utf8"))?.pull_request?.number;
  } catch {
    return undefined;
  }
  if (typeof number !== "number") return undefined;
  const files = new Set<string>();
  const limit = 50;
  for (let page = 1; page <= 200; page++) {
    const url = `${server}/api/v1/repos/${repository}/pulls/${number}/files?limit=${limit}&page=${page}`;
    let entries: Array<{ filename?: string; previous_filename?: string }>;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `token ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        console.log(`::warning::reading changed files: ${url} answered ${response.status}`);
        return undefined;
      }
      entries = (await response.json()) as typeof entries;
    } catch (error) {
      console.log(`::warning::reading changed files: ${String(error)}`);
      return undefined;
    }
    for (const entry of entries) {
      if (entry.filename) files.add(entry.filename);
      if (entry.previous_filename) files.add(entry.previous_filename);
    }
    if (entries.length < limit) return [...files];
  }
  return undefined;
};

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const main = async () => {
  const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const base = argument("--base") ?? process.env.GITHUB_BASE_REF ?? defaultBranches[0] ?? "";
  const named = argument("--lanes") ?? process.env.PR_LANES;

  let selection: Selection;
  if (process.argv.includes("--all") || named === "all") {
    selection = selectLanes(configuredLanes, base, undefined);
  } else if (named) {
    const ids = named.split(",").map((id) => id.trim());
    const unknown = ids.filter((id) => !configuredLanes.some((lane) => lane.id === id));
    if (unknown.length > 0) {
      console.error(`Unknown lane(s): ${unknown.join(", ")}`);
      process.exit(2);
    }
    selection = {
      lanes: configuredLanes.filter((lane) => ids.includes(lane.id)),
      reason: `--lanes ${named}`,
    };
  } else {
    const files = argument("--files")?.split(",") ?? (await changedFilesFromForgejo());
    selection = selectLanes(configuredLanes, base, files);
  }

  const { cpus, memory } = containerLimits();
  const concurrency = Number(process.env.PR_LANES_CONCURRENCY) || defaultConcurrency(cpus, memory);
  const commands = new Set(selection.lanes.flatMap((lane) => lane.commands.map(commandKey)));
  console.log(
    `PR lanes for base ${base} (${selection.reason}): ${selection.lanes.length} lane(s), ` +
      `${commands.size} distinct command(s), ${concurrency} at a time.`,
  );
  for (const lane of selection.lanes) console.log(`  ${lane.id}`);
  if (process.argv.includes("--list") || selection.lanes.length === 0) return;

  const results = await runLanes(selection.lanes, {
    concurrency,
    execute: executeInShell(root),
    onResult: printResult,
  });

  console.log("\nLane results:");
  for (const result of results) {
    const failed = result.failed ? `  at: ${commandLabel(result.failed)}` : "";
    console.log(`  ${result.outcome.padEnd(7)} ${result.lane.id}${failed}`);
  }
  const failures = results.filter((result) => result.outcome !== "pass");
  if (failures.length > 0) {
    console.log(
      `::error::${failures.length} lane(s) failed: ${failures.map((r) => r.lane.id).join(", ")}`,
    );
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  await main();
}
