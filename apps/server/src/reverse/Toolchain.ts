// @effect-diagnostics nodeBuiltinImport:off - inspects host paths for the native toolchain.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { ReverseToolchainResult } from "@t3tools/contracts";

type Tool = ReverseToolchainResult["tools"][number];

const isExecutable = (path: string) =>
  NodeFSP.access(path, NodeFS.constants.X_OK).then(
    () => true,
    () => false,
  );

/** Finds an executable on PATH without running it. */
async function onPath(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? "").split(NodePath.delimiter)) {
    if (!dir) continue;
    const candidate = NodePath.join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function binary(
  id: string,
  label: string,
  name: string,
  requiredFor: Tool["requiredFor"],
  hint: string,
  env: NodeJS.ProcessEnv,
): Promise<Tool> {
  const found = await onPath(name, env);
  return found
    ? { id, label, status: "ready", detail: found, requiredFor, hint }
    : { id, label, status: "missing", detail: `${name} is not on PATH.`, requiredFor, hint };
}

async function sandbox(env: NodeJS.ProcessEnv): Promise<Tool> {
  const base = {
    id: "sandbox",
    label: "Sandbox launcher",
    requiredFor: [
      "ghidra",
      "gadgets",
      "binwalk",
      "unblob",
      "rea",
      "emulate",
    ] as Tool["requiredFor"],
    hint: "Set T3_REVERSE_SANDBOX_COMMAND to a JSON argv array whose first entry is an absolute path to an isolating launcher (for example a container or bubblewrap wrapper). Firmware tools never run without it.",
  };
  const configured = env.T3_REVERSE_SANDBOX_COMMAND;
  if (!configured)
    return { ...base, status: "missing", detail: "T3_REVERSE_SANDBOX_COMMAND is not set." };
  let argv: unknown;
  try {
    argv = JSON.parse(configured);
  } catch {
    return { ...base, status: "misconfigured", detail: "T3_REVERSE_SANDBOX_COMMAND is not JSON." };
  }
  const launcher = Array.isArray(argv) ? argv[0] : undefined;
  if (typeof launcher !== "string" || !NodePath.isAbsolute(launcher))
    return {
      ...base,
      status: "misconfigured",
      detail: "The first argv entry must be an absolute executable path.",
    };
  return (await isExecutable(launcher))
    ? { ...base, status: "ready", detail: launcher }
    : { ...base, status: "misconfigured", detail: `${launcher} is not an executable file.` };
}

async function ghidra(env: NodeJS.ProcessEnv): Promise<Tool> {
  const base = {
    id: "ghidra",
    label: "Ghidra",
    requiredFor: ["ghidra"] as Tool["requiredFor"],
    hint: "Install Ghidra 12.1 and set GHIDRA_INSTALL_DIR to its folder, and T3_REVERSE_GHIDRA_SCRIPTS to the folder holding ReverseBridge.java.",
  };
  const install = env.GHIDRA_INSTALL_DIR;
  if (!install || !NodePath.isAbsolute(install))
    return { ...base, status: "missing", detail: "GHIDRA_INSTALL_DIR is not an absolute path." };
  if (!(await isExecutable(NodePath.join(install, "support", "analyzeHeadless"))))
    return {
      ...base,
      status: "misconfigured",
      detail: `${install} has no support/analyzeHeadless.`,
    };
  const properties = await NodeFSP.readFile(
    NodePath.join(install, "Ghidra", "application.properties"),
    "utf8",
  ).catch(() => "");
  const version = /^application.version=(.+)$/m.exec(properties)?.[1]?.trim();
  const scripts = env.T3_REVERSE_GHIDRA_SCRIPTS;
  if (
    !scripts ||
    !NodePath.isAbsolute(scripts) ||
    !(await NodeFSP.stat(NodePath.join(scripts, "ReverseBridge.java")).catch(() => null))
  )
    return {
      ...base,
      status: "misconfigured",
      detail: "T3_REVERSE_GHIDRA_SCRIPTS must be an absolute folder containing ReverseBridge.java.",
    };
  return { ...base, status: "ready", detail: version ? `Ghidra ${version}` : install };
}

async function java(env: NodeJS.ProcessEnv): Promise<Tool> {
  const base = {
    id: "java",
    label: "Java 21",
    requiredFor: ["ghidra"] as Tool["requiredFor"],
    hint: "Install a JDK 21 (for example Temurin) and put java on PATH or set JAVA_HOME.",
  };
  const fromHome = env.JAVA_HOME ? NodePath.join(env.JAVA_HOME, "bin", "java") : null;
  const found = fromHome && (await isExecutable(fromHome)) ? fromHome : await onPath("java", env);
  return found
    ? { ...base, status: "ready", detail: found }
    : { ...base, status: "missing", detail: "No java on PATH or under JAVA_HOME." };
}

/**
 * Reports which native tools this environment can run, without executing any of them.
 * Tools run inside the sandbox launcher, so a binary found here may still need to exist there.
 */
export async function inspectToolchain(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReverseToolchainResult> {
  const tools = await Promise.all([
    sandbox(env),
    ghidra(env),
    java(env),
    binary(
      "binwalk",
      "Binwalk",
      "binwalk",
      ["binwalk"],
      "pip install binwalk, or brew install binwalk.",
      env,
    ),
    binary(
      "unblob",
      "Unblob",
      "unblob",
      ["unblob"],
      "pip install unblob (see unblob.org for its extractors).",
      env,
    ),
    binary("ropgadget", "ROPgadget", "ROPgadget", ["gadgets"], "pip install ROPgadget.", env),
    binary("rea", "REA", "rea", ["rea"], "Install the rea CLI and put it on PATH.", env),
    binary(
      "qemu",
      "QEMU (Arm)",
      "qemu-system-arm",
      ["emulate"],
      "brew install qemu, or apt install qemu-system-arm.",
      env,
    ),
  ]);
  return { tools };
}
