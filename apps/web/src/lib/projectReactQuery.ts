import type {
  EnvironmentId,
  NativeApi,
  ProjectCodeDefinitionsResult,
  ProjectCodeDocumentSymbolsResult,
  ProjectCodeHoverResult,
  ProjectListEntriesResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { ensureEnvironmentApi } from "~/environmentApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  readFile: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
  ) => ["projects", "read-file", environmentId ?? null, cwd, relativePath] as const,
  listEntries: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["projects", "list-entries", environmentId ?? null, cwd] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", environmentId ?? null, cwd, query, limit] as const,
  codeDocumentSymbols: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
  ) => ["projects", "code-document-symbols", environmentId ?? null, cwd, relativePath] as const,
  codeHover: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
    line: number,
    column: number,
  ) => ["projects", "code-hover", environmentId ?? null, cwd, relativePath, line, column] as const,
  codeDefinitions: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
    line: number,
    column: number,
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

const DEFAULT_READ_FILE_STALE_TIME = 15_000;
const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_CODE_DOCUMENT_SYMBOLS_RESULT: ProjectCodeDocumentSymbolsResult = {
  source: "none",
  symbols: [],
};
const EMPTY_CODE_HOVER_RESULT: ProjectCodeHoverResult = {
  source: "none",
  hover: null,
};
const EMPTY_CODE_DEFINITIONS_RESULT: ProjectCodeDefinitionsResult = {
  source: "none",
  definitions: [],
};
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_LIST_ENTRIES_RESULT: ProjectListEntriesResult = {
  entries: [],
  truncated: false,
};

type ProjectApi = NativeApi["projects"];

function readWindowProjectApi(): ProjectApi | null {
  if (typeof window === "undefined" || !window.nativeApi) {
    return null;
  }

  const nativeProjects = (window.nativeApi as Partial<NativeApi>).projects;
  return nativeProjects ?? null;
}

function resolveProjectApi(environmentId: EnvironmentId | null): ProjectApi {
  const nativeProjects = readWindowProjectApi();
  if (nativeProjects) {
    return nativeProjects;
  }

  if (environmentId !== null) {
    return ensureEnvironmentApi(environmentId).projects as ProjectApi;
  }

  return getPrimaryEnvironmentConnection().client.projects as ProjectApi;
}

export function projectReadFileQueryOptions(input: {
  environmentId?: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.environmentId ?? null, input.cwd, input.relativePath),
    queryFn: async () => {
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace file reading is unavailable.");
      }
      const api = resolveProjectApi(input.environmentId ?? null);
      return api.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
  });
}

export function projectListEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listEntries(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace entry listing requires an active environment.");
      }
      return resolveProjectApi(input.environmentId).listEntries({
        cwd: input.cwd,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_LIST_ENTRIES_RESULT,
  });
}

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
        throw new Error("Workspace entry search requires an active environment.");
      }
      return resolveProjectApi(input.environmentId).searchEntries({
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

export function projectCodeDocumentSymbolsQueryOptions(input: {
  environmentId?: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.codeDocumentSymbols(
      input.environmentId ?? null,
      input.cwd,
      input.relativePath,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace document symbols are unavailable.");
      }
      const api = resolveProjectApi(input.environmentId ?? null);
      return api.getDocumentSymbols({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_CODE_DOCUMENT_SYMBOLS_RESULT,
  });
}

export function projectCodeHoverQueryOptions(input: {
  environmentId?: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  line: number | null;
  column: number | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.codeHover(
      input.environmentId ?? null,
      input.cwd,
      input.relativePath,
      input.line ?? 0,
      input.column ?? 0,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.relativePath || input.line === null || input.column === null) {
        throw new Error("Workspace hover is unavailable.");
      }
      const api = resolveProjectApi(input.environmentId ?? null);
      return api.getHover({
        cwd: input.cwd,
        relativePath: input.relativePath,
        line: input.line,
        column: input.column,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.cwd !== null &&
      input.relativePath !== null &&
      input.line !== null &&
      input.column !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_CODE_HOVER_RESULT,
  });
}

export function projectCodeDefinitionsQueryOptions(input: {
  environmentId?: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  line: number | null;
  column: number | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.codeDefinitions(
      input.environmentId ?? null,
      input.cwd,
      input.relativePath,
      input.line ?? 0,
      input.column ?? 0,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.relativePath || input.line === null || input.column === null) {
        throw new Error("Workspace definitions are unavailable.");
      }
      const api = resolveProjectApi(input.environmentId ?? null);
      return api.getDefinitions({
        cwd: input.cwd,
        relativePath: input.relativePath,
        line: input.line,
        column: input.column,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.cwd !== null &&
      input.relativePath !== null &&
      input.line !== null &&
      input.column !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_CODE_DEFINITIONS_RESULT,
  });
}
