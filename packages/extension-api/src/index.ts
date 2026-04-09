/**
 * @t3tools/extension-api - Shared contract for runtime-discoverable T3 Code extensions.
 *
 * This package defines the public boundary between the host and extension
 * packages. The host discovers extension manifests at runtime, validates them
 * with Effect Schema, and renders approved client entries into explicit slots.
 *
 * ARCHITECTURE:
 *
 *   @t3tools/extension-api (this package)
 *   ├── ExtensionSlotSchema / ExtensionCapabilitySchema
 *   ├── ExtensionClientEntrySchema / ExtensionManifestSchema
 *   └── read-only panel/thread/project view types
 *
 *   Extension package
 *   ├── ships a manifest with slots/capabilities/client entries
 *   └── renders into host-owned slots
 *
 *   @t3tools/web and @t3tools/server
 *   ├── discover manifests at runtime
 *   ├── validate them against these schemas
 *   └── mediate privileged actions through host APIs
 */

import { Cause, Schema, SchemaIssue } from "effect";
import type { ReactNode } from "react";
import type {
  ApprovalRequestId,
  OrchestrationProposedPlanId,
  ProjectEntry,
  ProjectId,
  ProjectScript,
  ThreadId,
  TurnId,
  RuntimeMode,
  ProviderInteractionMode,
  OrchestrationLatestTurn,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString, TrimmedString } from "@t3tools/contracts";

export const EXTENSION_SLOTS = [
  "thread.sidePanel",
  "threads.sidebar.section",
  "thread.header.actions",
] as const;

export const ExtensionSlotSchema = Schema.Literals(EXTENSION_SLOTS);
export type ExtensionSlot = typeof ExtensionSlotSchema.Type;

export const EXTENSION_CAPABILITIES = [
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

export const ExtensionCapabilitySchema = Schema.Literals(EXTENSION_CAPABILITIES);
export type ExtensionCapability = typeof ExtensionCapabilitySchema.Type;

export const ExtensionClientEntrySchema = Schema.Struct({
  slot: ExtensionSlotSchema,
  module: TrimmedNonEmptyString,
  exportName: Schema.optional(TrimmedNonEmptyString),
});
export type ExtensionClientEntry = typeof ExtensionClientEntrySchema.Type;

export const ExtensionManifestSchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedString),
  hostVersionRange: TrimmedNonEmptyString,
  slots: Schema.Array(ExtensionSlotSchema).check(Schema.isNonEmpty()),
  capabilities: Schema.Array(ExtensionCapabilitySchema).check(Schema.isNonEmpty()),
  clientEntries: Schema.Array(ExtensionClientEntrySchema).check(Schema.isNonEmpty()),
});
export type ExtensionManifest = typeof ExtensionManifestSchema.Type;

export interface ExtensionManifestIssue {
  path: string;
  message: string;
}

export interface ExtensionManifestParseSuccess {
  success: true;
  manifest: ExtensionManifest;
}

export interface ExtensionManifestParseFailure {
  success: false;
  errors: ReadonlyArray<ExtensionManifestIssue>;
}

export type ExtensionManifestParseResult =
  | ExtensionManifestParseSuccess
  | ExtensionManifestParseFailure;

function createIssue(path: string, message: string): ExtensionManifestIssue {
  return { path, message };
}

function formatIssuePath(path: ReadonlyArray<unknown> | undefined): string {
  if (!path || path.length === 0) return "";

  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
      continue;
    }
    const text =
      typeof segment === "symbol" ? (segment.description ?? String(segment)) : String(segment);
    formatted += formatted === "" ? text : `.${text}`;
  }
  return formatted;
}

function formatSchemaIssues(error: unknown): ExtensionManifestIssue[] {
  if (!Schema.isSchemaError(error)) {
    return [
      createIssue("", error instanceof Error ? error.message : "Invalid extension manifest."),
    ];
  }

  const formatter = SchemaIssue.makeFormatterStandardSchemaV1();
  const result = formatter(error.issue);
  return result.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

function collectSlotSubsetIssues(manifest: ExtensionManifest): ExtensionManifestIssue[] {
  const declaredSlots = new Set(manifest.slots);
  const issues: ExtensionManifestIssue[] = [];

  for (const [index, entry] of manifest.clientEntries.entries()) {
    if (declaredSlots.has(entry.slot)) continue;
    issues.push(
      createIssue(
        `clientEntries[${index}].slot`,
        `Client entry slot "${entry.slot}" must be declared in slots.`,
      ),
    );
  }

  return issues;
}

export function parseExtensionManifest(input: unknown): ExtensionManifestParseResult {
  const result = Schema.decodeUnknownExit(ExtensionManifestSchema)(input);
  if (result._tag === "Failure") {
    return {
      success: false,
      errors: formatSchemaIssues(Cause.squash(result.cause)),
    };
  }

  const slotSubsetIssues = collectSlotSubsetIssues(result.value);
  if (slotSubsetIssues.length > 0) {
    return {
      success: false,
      errors: slotSubsetIssues,
    };
  }

  return {
    success: true,
    manifest: result.value,
  };
}

// ─── Thread & Project (read-only views for panels) ───

export interface PanelProject {
  id: ProjectId;
  name: string;
  cwd: string;
  model: string;
  scripts: ProjectScript[];
}

export interface PanelThread {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  latestTurn: OrchestrationLatestTurn | null;
}

// ─── Derived session state (read-only for panels) ───

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<{ question: string }>;
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
}

export type PanelRunOverlayStatus = "starting" | "running" | "blocked" | "completed" | "failed";

export interface PanelRunOverlayApproval {
  requestId: ApprovalRequestId;
  createdAt: string;
  detail?: string;
  requestKind?: string;
  runId: string | null;
  agentId: string | null;
}

export interface PanelRunOverlayUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<{ question: string }>;
  runId: string | null;
  agentId: string | null;
}

export interface PanelRunOverlayArtifact {
  id: string;
  runId: string;
  agentId: string | null;
  taskId: string | null;
  kind: string | null;
  title: string | null;
  promoted: boolean;
  updatedAt: string;
}

export interface PanelRunOverlayTask {
  id: string;
  title: string | null;
  status: PanelRunOverlayStatus;
  detail: string | null;
  blocker: string | null;
  assignedAt: string;
}

export interface PanelRunOverlayAgent {
  id: string;
  runId: string;
  label: string | null;
  status: PanelRunOverlayStatus;
  threadId: string | null;
  parentAgentId: string | null;
  currentTask: PanelRunOverlayTask | null;
  artifacts: ReadonlyArray<PanelRunOverlayArtifact>;
  pendingApprovals: ReadonlyArray<PanelRunOverlayApproval>;
  pendingUserInputs: ReadonlyArray<PanelRunOverlayUserInput>;
  latestActivityAt: string;
}

export interface PanelRunOverlay {
  rootRunId: string;
  status: PanelRunOverlayStatus;
  agents: ReadonlyArray<PanelRunOverlayAgent>;
  pendingApprovals: ReadonlyArray<PanelRunOverlayApproval>;
  pendingUserInputs: ReadonlyArray<PanelRunOverlayUserInput>;
  artifacts: ReadonlyArray<PanelRunOverlayArtifact>;
  latestActivityAt: string;
}

export interface PanelRunAgentInspectorView {
  agent: PanelRunOverlayAgent;
  artifacts: ReadonlyArray<PanelRunOverlayArtifact>;
  pendingApprovals: ReadonlyArray<PanelRunOverlayApproval>;
  pendingUserInputs: ReadonlyArray<PanelRunOverlayUserInput>;
}

// ─── Host-mediated actions ───

export interface ExtensionWorkspaceWriteInput {
  cwd: string;
  relativePath: string;
  contents: string;
}

export interface ExtensionWorkspaceSearchInput {
  cwd: string;
  query: string;
  limit: number;
}

export interface ExtensionWorkspaceReadInput {
  cwd: string;
  relativePath: string;
}

export type ExtensionWorkspaceOpenTarget = "default" | "alternate" | "viewer" | "editor";

export interface ExtensionWorkspaceOpenInput {
  cwd: string;
  relativePath: string;
  line?: number | null;
  column?: number | null;
  target?: ExtensionWorkspaceOpenTarget;
}

export type ExtensionWorkspaceReadFailureReason =
  | "missing-capability"
  | "missing-native-api"
  | "read-failed";

export interface ExtensionWorkspaceReadSuccess {
  ok: true;
  relativePath: string;
  contents: string;
}

export interface ExtensionWorkspaceReadFailure {
  ok: false;
  reason: ExtensionWorkspaceReadFailureReason;
  message: string;
}

export type ExtensionWorkspaceReadResult =
  | ExtensionWorkspaceReadSuccess
  | ExtensionWorkspaceReadFailure;

export type ExtensionWorkspaceSearchFailureReason =
  | "missing-capability"
  | "missing-native-api"
  | "search-failed";

export interface ExtensionWorkspaceSearchSuccess {
  ok: true;
  entries: ReadonlyArray<ProjectEntry>;
  truncated: boolean;
}

export interface ExtensionWorkspaceSearchFailure {
  ok: false;
  reason: ExtensionWorkspaceSearchFailureReason;
  message: string;
}

export type ExtensionWorkspaceSearchResult =
  | ExtensionWorkspaceSearchSuccess
  | ExtensionWorkspaceSearchFailure;

export type ExtensionWorkspaceWriteFailureReason =
  | "missing-capability"
  | "missing-native-api"
  | "write-failed";

export interface ExtensionWorkspaceWriteSuccess {
  ok: true;
  relativePath: string;
}

export interface ExtensionWorkspaceWriteFailure {
  ok: false;
  reason: ExtensionWorkspaceWriteFailureReason;
  message: string;
}

export type ExtensionWorkspaceWriteResult =
  | ExtensionWorkspaceWriteSuccess
  | ExtensionWorkspaceWriteFailure;

export type ExtensionWorkspaceOpenFailureReason = "missing-capability" | "open-failed";

export interface ExtensionWorkspaceOpenSuccess {
  ok: true;
  relativePath: string;
  target: "viewer" | "editor";
}

export interface ExtensionWorkspaceOpenFailure {
  ok: false;
  reason: ExtensionWorkspaceOpenFailureReason;
  message: string;
}

export type ExtensionWorkspaceOpenResult =
  | ExtensionWorkspaceOpenSuccess
  | ExtensionWorkspaceOpenFailure;

export interface ExtensionOpenThreadInput {
  threadId: ThreadId;
}

export type ExtensionOpenThreadFailureReason = "missing-capability" | "open-failed";

export interface ExtensionOpenThreadSuccess {
  ok: true;
  threadId: ThreadId;
}

export interface ExtensionOpenThreadFailure {
  ok: false;
  reason: ExtensionOpenThreadFailureReason;
  message: string;
}

export type ExtensionOpenThreadResult = ExtensionOpenThreadSuccess | ExtensionOpenThreadFailure;

export const EXTENSION_RESOURCE_KINDS = ["workspace-file"] as const;
export type ExtensionResourceKind = (typeof EXTENSION_RESOURCE_KINDS)[number];

export interface ExtensionWorkspaceFileResourceTarget {
  kind: "workspace-file";
  cwd: string;
  relativePath: string;
  line: number | null;
  column: number | null;
}

export type ExtensionResourceTarget = ExtensionWorkspaceFileResourceTarget;
export type ExtensionResourceOpenTarget = "default" | "alternate" | "viewer" | "editor";
export type ExtensionOpenResourceFailureReason = "missing-capability" | "open-failed";

export interface ExtensionOpenResourceInput {
  resource: ExtensionResourceTarget;
  target?: ExtensionResourceOpenTarget;
}

export interface ExtensionOpenResourceSuccess {
  ok: true;
  resource: ExtensionResourceTarget;
  target: "viewer" | "editor";
}

export interface ExtensionOpenResourceFailure {
  ok: false;
  reason: ExtensionOpenResourceFailureReason;
  message: string;
}

export type ExtensionOpenResourceResult =
  | ExtensionOpenResourceSuccess
  | ExtensionOpenResourceFailure;

export interface ExtensionHostActions {
  hasCapability(capability: ExtensionCapability): boolean;
  openThread(input: ExtensionOpenThreadInput): Promise<ExtensionOpenThreadResult>;
  openResource(input: ExtensionOpenResourceInput): Promise<ExtensionOpenResourceResult>;
  openWorkspaceFile(input: ExtensionWorkspaceOpenInput): Promise<ExtensionWorkspaceOpenResult>;
  readWorkspaceFile(input: ExtensionWorkspaceReadInput): Promise<ExtensionWorkspaceReadResult>;
  searchWorkspaceEntries(
    input: ExtensionWorkspaceSearchInput,
  ): Promise<ExtensionWorkspaceSearchResult>;
  requestWorkspaceWrite(
    input: ExtensionWorkspaceWriteInput,
  ): Promise<ExtensionWorkspaceWriteResult>;
}

// ─── Panel API ───

export type PanelSurface = "thread.sidePanel";

export interface PanelThreadView {
  thread: PanelThread;
  project: PanelProject | null;
  activePlan: ActivePlanState | null;
  latestProposedPlan: LatestProposedPlanState | null;
  runOverlay: PanelRunOverlay | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  workLog: WorkLogEntry[];
  latestTurnId: TurnId | null;
}

export interface PanelContext {
  activeThreadId: ThreadId | null;
  threadView: PanelThreadView | null;
  resourceTarget: ExtensionResourceTarget | null;
  hostActions?: ExtensionHostActions;
}

export interface PanelDefinition {
  id: string;
  title: string;
  surface: PanelSurface;
  order?: number;
  resourceKinds?: ReadonlyArray<ExtensionResourceKind>;
  isAvailable: (context: PanelContext) => boolean;
  render: (context: PanelContext) => ReactNode;
}
