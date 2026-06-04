// @effect-diagnostics nodeBuiltinImport:off
import * as FS from "node:fs";
import * as Path from "node:path";

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
    FS.rmSync(Path.join(targetStateDir, fileName), { force: true });
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

  const sourceStateDir = Path.resolve(input.sourceStateDir);
  const targetStateDir = Path.resolve(input.targetStateDir);
  if (sourceStateDir === targetStateDir) {
    return { copied: false, reason: "same-target" };
  }
  if (!FS.existsSync(sourceStateDir)) {
    return { copied: false, reason: "source-missing" };
  }

  FS.mkdirSync(targetStateDir, { recursive: true });
  removeTargetSqliteStateFiles(targetStateDir);
  FS.cpSync(sourceStateDir, targetStateDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relativePath = Path.relative(sourceStateDir, sourcePath);
      return relativePath === "" || relativePath.split(Path.sep)[0] !== "logs";
    },
  });

  return { copied: true };
}
