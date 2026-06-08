// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface DesktopStartupStateSyncResult {
  readonly copied: boolean;
  readonly reason?: "disabled" | "not-gmacko" | "source-missing" | "same-target";
}

const SQLITE_STATE_FILE_NAMES = [
  "state.sqlite",
  "state.sqlite-wal",
  "state.sqlite-shm",
  "state.sqlite-journal",
] as const;

function isEnabled(rawValue: string | undefined): boolean {
  const value = rawValue?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function removeTargetSqliteStateFiles(targetStateDir: string): void {
  for (const fileName of SQLITE_STATE_FILE_NAMES) {
    NodeFS.rmSync(NodePath.join(targetStateDir, fileName), { force: true });
  }
}

export function maybeSyncNightlyEnvironmentToGmacko(input: {
  readonly isGmacko: boolean;
  readonly enabledValue: string | undefined;
  readonly sourceStateDir: string;
  readonly targetStateDir: string;
}): DesktopStartupStateSyncResult {
  if (!input.isGmacko) {
    return { copied: false, reason: "not-gmacko" };
  }
  if (!isEnabled(input.enabledValue)) {
    return { copied: false, reason: "disabled" };
  }

  const sourceStateDir = NodePath.resolve(input.sourceStateDir);
  const targetStateDir = NodePath.resolve(input.targetStateDir);
  if (sourceStateDir === targetStateDir) {
    return { copied: false, reason: "same-target" };
  }
  if (!NodeFS.existsSync(sourceStateDir)) {
    return { copied: false, reason: "source-missing" };
  }

  NodeFS.mkdirSync(targetStateDir, { recursive: true });
  removeTargetSqliteStateFiles(targetStateDir);
  NodeFS.cpSync(sourceStateDir, targetStateDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relativePath = NodePath.relative(sourceStateDir, sourcePath);
      return relativePath === "" || relativePath.split(NodePath.sep)[0] !== "logs";
    },
  });

  return { copied: true };
}
