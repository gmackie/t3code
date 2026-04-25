import type { ServerSettings } from "@t3tools/contracts/settings";

const TERMINAL_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseTerminalEnvironmentText(text: string): Record<string, string> {
  const entries: Array<[string, string]> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!TERMINAL_ENV_KEY_PATTERN.test(key)) {
      continue;
    }

    entries.push([key, line.slice(separatorIndex + 1)]);
  }

  return Object.fromEntries(entries);
}

export function resolveTerminalSettingsEnv(
  settings: ServerSettings["terminal"],
): Record<string, string> {
  const env = parseTerminalEnvironmentText(settings.environmentVariablesText);
  const zshStartupDirectory = settings.zshStartupDirectory.trim();
  return zshStartupDirectory ? { ...env, ZDOTDIR: zshStartupDirectory } : env;
}

export function mergeTerminalRuntimeEnv(
  runtimeEnv: Record<string, string>,
  settings: ServerSettings["terminal"],
): Record<string, string> {
  return {
    ...resolveTerminalSettingsEnv(settings),
    ...runtimeEnv,
  };
}
