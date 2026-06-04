import type {
  EnvironmentId,
  ProjectCodeDefinitionsResult,
  ProjectCodeHoverResult,
  ProjectReadFileResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", environmentId ?? null, cwd, query, limit] as const,
  readFile: (environmentId: EnvironmentId | null, cwd: string | null, relativePath: string) =>
    ["projects", "read-file", environmentId ?? null, cwd, relativePath] as const,
  codeHover: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string,
    line: number | null,
    column: number | null,
  ) => ["projects", "code-hover", environmentId ?? null, cwd, relativePath, line, column] as const,
  codeDefinitions: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string,
    line: number | null,
    column: number | null,
  ) =>
    [
      "projects",
      "code-definitions",
      environmentId ?? null,
      cwd,
      relativePath,
      line,
      column,
    ] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_HOVER_RESULT: ProjectCodeHoverResult = { source: "none", hover: null };
const EMPTY_DEFINITIONS_RESULT: ProjectCodeDefinitionsResult = { source: "none", definitions: [] };

export function projectSearchEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.environmentId, input.cwd, input.query, limit),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace entry search is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string;
  enabled?: boolean;
}) {
  return queryOptions<ProjectReadFileResult>({
    queryKey: projectQueryKeys.readFile(input.environmentId, input.cwd, input.relativePath),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace file reading is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.relativePath.length > 0,
  });
}

export function projectCodeHoverQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string;
  line: number | null;
  column: number | null;
  enabled?: boolean;
}) {
  return queryOptions<ProjectCodeHoverResult>({
    queryKey: projectQueryKeys.codeHover(
      input.environmentId,
      input.cwd,
      input.relativePath,
      input.line,
      input.column,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || input.line === null || input.column === null) {
        return EMPTY_HOVER_RESULT;
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.getHover({
        cwd: input.cwd,
        relativePath: input.relativePath,
        line: input.line,
        column: input.column,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.line !== null &&
      input.column !== null,
    placeholderData: (previous) => previous ?? EMPTY_HOVER_RESULT,
  });
}

export function projectCodeDefinitionsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string;
  line: number | null;
  column: number | null;
  enabled?: boolean;
}) {
  return queryOptions<ProjectCodeDefinitionsResult>({
    queryKey: projectQueryKeys.codeDefinitions(
      input.environmentId,
      input.cwd,
      input.relativePath,
      input.line,
      input.column,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || input.line === null || input.column === null) {
        return EMPTY_DEFINITIONS_RESULT;
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.getDefinitions({
        cwd: input.cwd,
        relativePath: input.relativePath,
        line: input.line,
        column: input.column,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.line !== null &&
      input.column !== null,
    placeholderData: (previous) => previous ?? EMPTY_DEFINITIONS_RESULT,
  });
}
