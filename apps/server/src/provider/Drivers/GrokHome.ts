// @effect-diagnostics nodeBuiltinImport:off -- Pure path normalization is shared by process launch and native history discovery.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function resolveEffectiveGrokHome(input: {
  readonly configuredHomePath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly userHome?: string;
}): string {
  const userHome = input.userHome ?? input.environment?.HOME?.trim() ?? NodeOS.homedir();
  const selected =
    input.configuredHomePath?.trim() || input.environment?.GROK_HOME?.trim() || "~/.grok";
  if (selected === "~") return NodePath.resolve(userHome);
  if (selected.startsWith("~/")) return NodePath.resolve(userHome, selected.slice(2));
  return NodePath.resolve(selected);
}
