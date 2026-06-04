import type {
  EnvironmentId,
  EnvironmentApi,
  ProjectCodeDefinitionsResult,
  ProjectCodeDocumentSymbolsResult,
  ProjectCodeHoverResult,
} from "@t3tools/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

const EMPTY_PROJECT_DOCUMENT_SYMBOLS_RESULT: ProjectCodeDocumentSymbolsResult = {
  source: "none",
  symbols: [],
};

const EMPTY_PROJECT_HOVER_RESULT: ProjectCodeHoverResult = {
  source: "none",
  hover: null,
};

const EMPTY_PROJECT_DEFINITIONS_RESULT: ProjectCodeDefinitionsResult = {
  source: "none",
  definitions: [],
};

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  const projectRpcClient = rpcClient.projects as typeof rpcClient.projects & {
    getDocumentSymbols?: EnvironmentApi["projects"]["getDocumentSymbols"];
    getHover?: EnvironmentApi["projects"]["getHover"];
    getDefinitions?: EnvironmentApi["projects"]["getDefinitions"];
  };

  return {
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listEntries: rpcClient.projects.listEntries,
      readFile: rpcClient.projects.readFile,
      searchEntries: rpcClient.projects.searchEntries,
      getDocumentSymbols:
        projectRpcClient.getDocumentSymbols ?? (async () => EMPTY_PROJECT_DOCUMENT_SYMBOLS_RESULT),
      getHover: projectRpcClient.getHover ?? (async () => EMPTY_PROJECT_HOVER_RESULT),
      getDefinitions:
        projectRpcClient.getDefinitions ?? (async () => EMPTY_PROJECT_DEFINITIONS_RESULT),
      writeFile: rpcClient.projects.writeFile,
    },
    filesystem: {
      browse: rpcClient.filesystem.browse,
    },
    git: {
      pull: rpcClient.git.pull,
      refreshStatus: rpcClient.git.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.git.onStatus(input, callback, options),
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    orchestration: {
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
