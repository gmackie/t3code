import { Schema } from "effect";
import { ExecutionEnvironmentDescriptor } from "./environment";
import { ServerAuthDescriptor } from "./auth";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { ServerSettings } from "./settings";

export const SERVER_EXTENSION_ASSET_ROUTE_PREFIX = "/__t3/extensions/" as const;

export const DesktopServerExposureMode = Schema.Literals(["local-only", "network-accessible"]);
export type DesktopServerExposureMode = typeof DesktopServerExposureMode.Type;

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerExtensionDiscoveryState = Schema.Literals(["enabled", "disabled"]);
export type ServerExtensionDiscoveryState = typeof ServerExtensionDiscoveryState.Type;

export const ServerExtensionSlots = [
  "thread.sidePanel",
  "threads.sidebar.section",
  "thread.header.actions",
] as const;
export const ServerExtensionSlot = Schema.Literals(ServerExtensionSlots);
export type ServerExtensionSlot = typeof ServerExtensionSlot.Type;

export const ServerExtensionCapabilities = [
  "read.thread-view",
  "read.threads-list",
  "action.open-external-url",
  "action.open-thread",
  "action.open-resource",
  "action.open-workspace-file",
  "action.read-workspace-file",
  "action.search-workspace-entries",
  "action.request-workspace-write",
  "action.browser-tab-intent",
] as const;
export const ServerExtensionCapability = Schema.Literals(ServerExtensionCapabilities);
export type ServerExtensionCapability = typeof ServerExtensionCapability.Type;

export const ServerExtensionDiscoveryIssue = Schema.Struct({
  path: TrimmedString,
  message: TrimmedNonEmptyString,
});
export type ServerExtensionDiscoveryIssue = typeof ServerExtensionDiscoveryIssue.Type;

export const ServerExtensionRepositoryState = Schema.Literals([
  "idle",
  "checking",
  "up-to-date",
  "update-available",
  "error",
]);
export type ServerExtensionRepositoryState = typeof ServerExtensionRepositoryState.Type;

export const ServerExtensionGitRepository = Schema.Struct({
  kind: Schema.Literal("git"),
  remoteUrl: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  upstreamRef: Schema.NullOr(TrimmedNonEmptyString),
  localCommit: Schema.NullOr(TrimmedNonEmptyString),
  remoteCommit: Schema.NullOr(TrimmedNonEmptyString),
  state: ServerExtensionRepositoryState,
  checkedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerExtensionGitRepository = typeof ServerExtensionGitRepository.Type;

export const ServerExtensionManifestClientEntry = Schema.Struct({
  slot: ServerExtensionSlot,
  module: TrimmedNonEmptyString,
  exportName: Schema.optional(TrimmedNonEmptyString),
});
export type ServerExtensionManifestClientEntry = typeof ServerExtensionManifestClientEntry.Type;

export const ServerExtensionManifest = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedString),
  hostVersionRange: TrimmedNonEmptyString,
  slots: Schema.Array(ServerExtensionSlot).check(Schema.isNonEmpty()),
  capabilities: Schema.Array(ServerExtensionCapability).check(Schema.isNonEmpty()),
  clientEntries: Schema.Array(ServerExtensionManifestClientEntry).check(Schema.isNonEmpty()),
});
export type ServerExtensionManifest = typeof ServerExtensionManifest.Type;

export const ServerExtensionRegistryEntry = Schema.Struct({
  id: Schema.NullOr(TrimmedNonEmptyString),
  name: Schema.NullOr(TrimmedNonEmptyString),
  rootPath: TrimmedNonEmptyString,
  extensionPath: TrimmedNonEmptyString,
  manifestPath: TrimmedNonEmptyString,
  state: ServerExtensionDiscoveryState,
  reason: Schema.NullOr(TrimmedNonEmptyString),
  issues: Schema.Array(ServerExtensionDiscoveryIssue),
  manifest: Schema.NullOr(ServerExtensionManifest),
  repository: Schema.NullOr(ServerExtensionGitRepository),
});
export type ServerExtensionRegistryEntry = typeof ServerExtensionRegistryEntry.Type;

const ServerExtensionRegistryEntries = Schema.Array(ServerExtensionRegistryEntry);

export const ServerExtensionRegistrySnapshot = Schema.Struct({
  hostVersion: TrimmedNonEmptyString,
  extensions: ServerExtensionRegistryEntries,
});
export type ServerExtensionRegistrySnapshot = typeof ServerExtensionRegistrySnapshot.Type;

export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerExtensionSourceSyncState = Schema.Literals([
  "idle",
  "syncing",
  "ready",
  "error",
]);
export type ServerExtensionSourceSyncState = typeof ServerExtensionSourceSyncState.Type;

export const ServerExtensionSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  repoUrl: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  relativePath: TrimmedNonEmptyString,
  syncState: ServerExtensionSourceSyncState,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerExtensionSource = typeof ServerExtensionSource.Type;

export const ServerExtensionSourcesSnapshot = Schema.Struct({
  sources: Schema.Array(ServerExtensionSource),
});
export type ServerExtensionSourcesSnapshot = typeof ServerExtensionSourcesSnapshot.Type;

export const ServerUpsertExtensionSourceInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  repoUrl: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedString),
});
export type ServerUpsertExtensionSourceInput = typeof ServerUpsertExtensionSourceInput.Type;

export const ServerRemoveExtensionSourceInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type ServerRemoveExtensionSourceInput = typeof ServerRemoveExtensionSourceInput.Type;

export const ServerSyncExtensionSourcesInput = Schema.Struct({
  ids: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type ServerSyncExtensionSourcesInput = typeof ServerSyncExtensionSourcesInput.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
  environment: ExecutionEnvironmentDescriptor,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;
