import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
  GitCreateBranchResult,
} from "./git";
import type {
  ProjectCodeDefinitionsInput,
  ProjectCodeDefinitionsResult,
  ProjectCodeDocumentSymbolsInput,
  ProjectCodeDocumentSymbolsResult,
  ProjectCodeHoverInput,
  ProjectCodeHoverResult,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ServerConfig,
  DesktopServerExposureMode,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from "./server";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import type { ServerUpsertKeybindingInput } from "./server";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "./orchestration";
import { EditorId } from "./editor";
import type { LocalPluginEnvelope } from "./localPluginEvents";
import { ServerSettings, ServerSettingsPatch } from "./settings";
import type { ThreadId } from "./baseSchemas";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
  wsUrl?: string | null;
}

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabRuntimeState {
  url: string;
  title: string | null;
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastError: string | null;
}

export interface BrowserEnsureTabInput {
  threadId: ThreadId;
  tabId: string;
  url?: string;
}

export interface BrowserNavigateInput {
  threadId: ThreadId;
  tabId: string;
  url: string;
}

export interface BrowserTabTargetInput {
  threadId: ThreadId;
  tabId: string;
}

export interface BrowserSyncHostInput {
  threadId: ThreadId;
  tabId: string | null;
  visible: boolean;
  bounds: BrowserBounds | null;
}

export interface BrowserClearThreadInput {
  threadId: ThreadId;
}

export interface BrowserCookieSource {
  id: string;
  label: string;
}

export interface BrowserCookieProfile {
  id: string;
  label: string;
}

export interface BrowserCookieDomain {
  domain: string;
  count: number;
}

export type BrowserCookieSameSite = "Strict" | "Lax" | "None";

export interface BrowserSessionCookie {
  domain: string;
  name: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: BrowserCookieSameSite;
  expirationLabel: string;
  removalUrl: string;
}

export interface BrowserListCookieDomainsInput {
  sourceId: string;
  profileId: string;
  search?: string;
}

export interface BrowserImportCookiesInput {
  sourceId: string;
  profileId: string;
  domains: string[];
}

export interface BrowserImportCookiesResult {
  importedCount: number;
  failedCount: number;
  importedDomains: BrowserCookieDomain[];
}

export interface BrowserRemoveCookieDomainResult {
  removedCount: number;
}

export interface BrowserTabStateEvent {
  type: "tab-state";
  threadId: ThreadId;
  tabId: string;
  state: BrowserTabRuntimeState;
}

export type BrowserEvent = BrowserTabStateEvent;
export interface DesktopBridge {
  getWsUrl?: () => string | null;
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  browserEnsureTab?: (input: BrowserEnsureTabInput) => Promise<void>;
  browserNavigate?: (input: BrowserNavigateInput) => Promise<void>;
  browserGoBack?: (input: BrowserTabTargetInput) => Promise<void>;
  browserGoForward?: (input: BrowserTabTargetInput) => Promise<void>;
  browserReload?: (input: BrowserTabTargetInput) => Promise<void>;
  browserCloseTab?: (input: BrowserTabTargetInput) => Promise<void>;
  browserSyncHost?: (input: BrowserSyncHostInput) => Promise<void>;
  browserClearThread?: (input: BrowserClearThreadInput) => Promise<void>;
  browserListCookieSources?: () => Promise<BrowserCookieSource[]>;
  browserListCookieProfiles?: (sourceId: string) => Promise<BrowserCookieProfile[]>;
  browserListCookieDomains?: (
    input: BrowserListCookieDomainsInput,
  ) => Promise<BrowserCookieDomain[]>;
  browserImportCookies?: (input: BrowserImportCookiesInput) => Promise<BrowserImportCookiesResult>;
  browserListSessionCookies?: () => Promise<BrowserSessionCookie[]>;
  browserRemoveCookieDomain?: (domain: string) => Promise<BrowserRemoveCookieDomainResult>;
  onLocalPluginEvent?: (listener: (event: LocalPluginEnvelope) => void) => () => void;
  onBrowserEvent?: (listener: (event: BrowserEvent) => void) => () => void;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, and git operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    getDocumentSymbols: (
      input: ProjectCodeDocumentSymbolsInput,
    ) => Promise<ProjectCodeDocumentSymbolsResult>;
    getHover: (input: ProjectCodeHoverInput) => Promise<ProjectCodeHoverResult>;
    getDefinitions: (input: ProjectCodeDefinitionsInput) => Promise<ProjectCodeDefinitionsResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  git: {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (
      callback: (event: OrchestrationEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
}

export interface NativeApi extends LocalApi, EnvironmentApi {}
