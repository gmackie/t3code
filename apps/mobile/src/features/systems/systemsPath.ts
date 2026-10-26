/** Preference key for one project's systems folder on one environment. */
export const systemsPathKey = (environmentId: string, projectId: string) =>
  `${environmentId}:${projectId}`;

/** A typed folder as the server expects it: trimmed, without leading or trailing slashes. */
export const normalizeSystemsPath = (draft: string) => draft.trim().replace(/^\/+|\/+$/g, "");

/** Stores `path` under `key`; the project root is the default, so it is not stored. */
export function withSystemsPath(
  paths: Readonly<Record<string, string>> | undefined,
  key: string,
  path: string,
): Readonly<Record<string, string>> {
  const next = { ...paths };
  if (path === "") delete next[key];
  else next[key] = path;
  return next;
}
