// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

// T3CODE-125 / FORGE-410: the nightly's git commands put tokens in their URLs.
// Command-line arguments are readable by every local user (`ps`), and the sync
// job runs on the shared gmacko-mini host; a URL given to `git clone` is also
// written to .git/config. Credentials must reach git through the environment.

const workflowsDir = NodeURL.fileURLToPath(new URL("../../.forgejo/workflows/", import.meta.url));
const nightlyPath = NodePath.join(workflowsDir, "gmacko-nightly.yml");

const GITHUB_SECRET = "ghp_T3CODE125githubsecret";
const FORGEJO_SECRET = "f0rgej0T3CODE125jobtokensecret";

const runStep = (workflow: string, name: string) => {
  const at = workflow.indexOf(`name: ${name}\n`);
  if (at < 0) throw new Error(`Missing step: ${name}`);
  const body = workflow.slice(at).match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1];
  if (!body) throw new Error(`Missing run block: ${name}`);
  return body.replace(/^ {10}/gm, "");
};

// A fake `git` that records every invocation's argv and auth environment and
// does just enough for the steps to run.
const fakeGit = `#!/usr/bin/env bash
{
  printf 'ARGV'; printf ' %q' "$@"; printf '\\n'
  for ((i = 0; i < \${GIT_CONFIG_COUNT:-0}; i++)); do
    key="GIT_CONFIG_KEY_$i"; value="GIT_CONFIG_VALUE_$i"
    printf 'ENV %s=%s\\n' "\${!key}" "\${!value}"
  done
} >> "$GIT_LOG"
for arg in "$@"; do
  case "$arg" in
    clone) for last; do :; done; mkdir -p "$last/.git"; exit 0 ;;
    ls-remote) echo "1111111111111111111111111111111111111111	refs/heads/custom-local"; exit 0 ;;
    rev-parse) echo 2222222222222222222222222222222222222222; exit 0 ;;
  esac
done
exit 0
`;

const runWithFakeGit = (script: string, env: Record<string, string>) => {
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmacko-git-auth-"));
  const bin = NodePath.join(scratch, "bin");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(NodePath.join(bin, "git"), fakeGit, { mode: 0o755 });
  const log = NodePath.join(scratch, "git.log");
  NodeFS.writeFileSync(log, "");
  NodeFS.mkdirSync(NodePath.join(scratch, "lane", ".git"), { recursive: true });
  try {
    NodeChildProcess.execFileSync("bash", ["-euo", "pipefail", "-c", script], {
      cwd: env.CWD === "lane" ? NodePath.join(scratch, "lane") : scratch,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: scratch,
        GIT_LOG: log,
        GITHUB_OUTPUT: NodePath.join(scratch, "output"),
        GITHUB_FORK: "gmackie/t3code",
        UPSTREAM_REPO: "pingdotgg/t3code",
        FORGEJO_REPO_URL: "https://git.forgegraf.com/gmackie/t3code.git",
        GITHUB_TOKEN: GITHUB_SECRET,
        FORGEJO_TOKEN: FORGEJO_SECRET,
        ...env,
      },
      stdio: "pipe",
    });
    return NodeFS.readFileSync(log, "utf8").split("\n").filter(Boolean);
  } finally {
    NodeFS.rmSync(scratch, { recursive: true, force: true });
  }
};

const basic = (user: string, token: string) =>
  `AUTHORIZATION: basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;

const expectNoCredentialInArgv = (lines: string[]) => {
  const argv = lines.filter((line) => line.startsWith("ARGV"));
  expect(argv.length).toBeGreaterThan(0);
  for (const line of argv) {
    expect(line).not.toContain(GITHUB_SECRET);
    expect(line).not.toContain(FORGEJO_SECRET);
    expect(line).not.toContain(Buffer.from(`x-access-token:${GITHUB_SECRET}`).toString("base64"));
    expect(line).not.toContain(Buffer.from(`x-access-token:${FORGEJO_SECRET}`).toString("base64"));
    expect(line.toLowerCase()).not.toContain("x-access-token");
    expect(line.toLowerCase()).not.toContain("authorization");
  }
};

describe("GMACKO nightly git credentials", () => {
  it("never writes a credential into a git URL in any ForgeGraph workflow", () => {
    for (const file of NodeFS.readdirSync(workflowsDir)) {
      const text = NodeFS.readFileSync(NodePath.join(workflowsDir, file), "utf8");
      // https://user:${TOKEN}@host, https://${TOKEN}@host, or a ${VAR/https:\/\//...@} rewrite.
      expect(text, file).not.toMatch(/https?:(?:\\\/|\/){2}[^\s"'@]*\$\{?\w+\}?@/);
      expect(text, file).not.toMatch(/x-access-token:\$/);
    }
  });

  it("clones the release lane with credentials only in the environment", () => {
    const workflow = NodeFS.readFileSync(nightlyPath, "utf8");
    const lines = runWithFakeGit(runStep(workflow, "Clone release lane"), {});
    expectNoCredentialInArgv(lines);
    expect(lines).toContain(
      `ENV http.https://git.forgegraf.com/gmackie/t3code.git.extraheader=${basic("x-access-token", FORGEJO_SECRET)}`,
    );
    const clone = lines.find((line) => line.startsWith("ARGV clone"));
    expect(clone).toContain("https://git.forgegraf.com/gmackie/t3code.git");
  });

  it("reads the GitHub lane tip without the PAT in argv", () => {
    const workflow = NodeFS.readFileSync(nightlyPath, "utf8");
    const lines = runWithFakeGit(runStep(workflow, "Merge upstream main into custom-local"), {
      CWD: "lane",
      GITHUB_EVENT_NAME: "push",
    });
    expectNoCredentialInArgv(lines);
    expect(lines).toContain(
      `ENV http.https://github.com/gmackie/t3code.git.extraheader=${basic("x-access-token", GITHUB_SECRET)}`,
    );
  });

  it("mirrors and promotes the lane without credentials in argv", () => {
    const workflow = NodeFS.readFileSync(nightlyPath, "utf8");
    const mirror = runWithFakeGit(runStep(workflow, "Mirror lane to ForgeGraph"), {
      CWD: "lane",
      GITHUB_EVENT_NAME: "schedule",
    });
    expectNoCredentialInArgv(mirror);
    expect(mirror.some((line) => line.startsWith("ARGV push"))).toBe(true);

    const promote = runWithFakeGit(
      runStep(workflow, "Advance GitHub custom-local to the verified lane tip"),
      {
        HAS_CHANGES: "true",
        HEAD_SHA: "2222222222222222222222222222222222222222",
        START_SHA: "1111111111111111111111111111111111111111",
      },
    );
    expectNoCredentialInArgv(promote);
    expect(promote.some((line) => line.includes("clone"))).toBe(true);
    expect(promote.some((line) => line.includes("push"))).toBe(true);
    expect(promote).toContain(
      `ENV http.https://github.com/gmackie/t3code.git.extraheader=${basic("x-access-token", GITHUB_SECRET)}`,
    );
  });
});
