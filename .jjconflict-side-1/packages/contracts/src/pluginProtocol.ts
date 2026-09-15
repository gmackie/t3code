import * as Schema from "effect/Schema";

import { PluginCapabilityRequest } from "./pluginCapabilities.ts";
import { PluginPackageSource } from "./pluginCatalog.ts";
import { PluginSettingContribution } from "./pluginSettings.ts";

export const PluginRuntime = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("managed-app"),
    command: Schema.Array(Schema.String),
    restart: Schema.Literals(["never", "on-failure", "always"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("attached"),
    endpoint: Schema.String,
    transport: Schema.Literals(["http", "stdio", "unix-socket"]),
  }),
]);

export const PluginCommandContribution = Schema.Struct({ id: Schema.String, title: Schema.String });
export const PluginActionInput = Schema.Struct({
  pluginId: Schema.String,
  actionId: Schema.String,
  navigationId: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  input: Schema.Unknown,
});
export type PluginActionInput = typeof PluginActionInput.Type;
export const PluginActionResult = Schema.Struct({
  status: Schema.Literals(["accepted", "completed", "rejected"]),
  message: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});
export type PluginActionResult = typeof PluginActionResult.Type;
export const PluginSurfaceAction = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  tone: Schema.optional(Schema.Literals(["primary", "secondary", "destructive"])),
});
export type PluginSurfaceAction = typeof PluginSurfaceAction.Type;
export const PluginWorkflowStage = Schema.Literals([
  "inspect",
  "context",
  "propose",
  "review",
  "approve",
  "execute",
  "verify",
  "respond",
]);
export type PluginWorkflowStage = typeof PluginWorkflowStage.Type;
export const PluginWorkflowStep = Schema.Struct({
  id: Schema.String,
  stage: PluginWorkflowStage,
  title: Schema.String,
  state: Schema.Literals(["pending", "active", "completed", "blocked", "failed"]),
  detail: Schema.optional(Schema.String),
});
export type PluginWorkflowStep = typeof PluginWorkflowStep.Type;
export const PluginWorkflowEvidence = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["check", "artifact", "diff", "log", "link"]),
  status: Schema.Literals(["neutral", "positive", "warning", "negative"]),
  detail: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export type PluginWorkflowEvidence = typeof PluginWorkflowEvidence.Type;
export const PluginWorkflowModel = Schema.Struct({
  pluginId: Schema.String,
  workflowId: Schema.String,
  title: Schema.String,
  currentStage: PluginWorkflowStage,
  refreshedAt: Schema.String,
  steps: Schema.Array(PluginWorkflowStep),
  evidence: Schema.optional(Schema.Array(PluginWorkflowEvidence)),
  actions: Schema.optional(Schema.Array(PluginSurfaceAction)),
});
export type PluginWorkflowModel = typeof PluginWorkflowModel.Type;
export const PluginWorkflowGetInput = Schema.Struct({
  pluginId: Schema.String,
  workflowId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
});
export type PluginWorkflowGetInput = typeof PluginWorkflowGetInput.Type;
export const PluginWorkflowActionInput = Schema.Struct({
  pluginId: Schema.String,
  workflowId: Schema.String,
  actionId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  input: Schema.Unknown,
});
export type PluginWorkflowActionInput = typeof PluginWorkflowActionInput.Type;
export const PluginWorkflowContribution = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  surface: Schema.Literals(["project", "thread.sidePanel", "thread.main"]),
});
export type PluginWorkflowContribution = typeof PluginWorkflowContribution.Type;
export const PluginPanelGetInput = Schema.Struct({
  pluginId: Schema.String,
  panelId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
});
export type PluginPanelGetInput = typeof PluginPanelGetInput.Type;
export const PluginPanelModel = Schema.Struct({
  pluginId: Schema.String,
  panelId: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["serial-console", "verification"]),
  refreshedAt: Schema.String,
  content: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("serial-console"),
      connection: Schema.Literals(["disconnected", "connecting", "connected", "error"]),
      target: Schema.String,
      lines: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          timestamp: Schema.String,
          stream: Schema.Literals(["stdout", "stderr", "system"]),
          text: Schema.String,
        }),
      ),
      actions: Schema.optional(Schema.Array(PluginSurfaceAction)),
    }),
    Schema.Struct({
      kind: Schema.Literal("verification"),
      status: Schema.Literals(["idle", "running", "passed", "failed", "inconclusive"]),
      summary: Schema.String,
      runs: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          title: Schema.String,
          status: Schema.String,
          detail: Schema.optional(Schema.String),
        }),
      ),
      actions: Schema.optional(Schema.Array(PluginSurfaceAction)),
    }),
  ]),
});
export type PluginPanelModel = typeof PluginPanelModel.Type;
export const PluginNavigationContribution = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  path: Schema.String,
});
export type PluginNavigationContribution = typeof PluginNavigationContribution.Type;
export const PluginSurfaceGetInput = Schema.Struct({
  pluginId: Schema.String,
  navigationId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
});
export type PluginSurfaceGetInput = typeof PluginSurfaceGetInput.Type;
const PluginSurfaceCardStatus = Schema.Literals(["neutral", "positive", "warning", "negative"]);
export const PluginSurfaceCard = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("metric"),
    id: Schema.String,
    title: Schema.String,
    value: Schema.String,
    detail: Schema.optional(Schema.String),
    status: Schema.optional(PluginSurfaceCardStatus),
    actions: Schema.optional(Schema.Array(PluginSurfaceAction)),
  }),
  Schema.Struct({
    kind: Schema.Literal("list"),
    id: Schema.String,
    title: Schema.String,
    items: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        detail: Schema.optional(Schema.String),
        status: Schema.optional(PluginSurfaceCardStatus),
        url: Schema.optional(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("notice"),
    id: Schema.String,
    title: Schema.String,
    message: Schema.String,
    status: Schema.optional(PluginSurfaceCardStatus),
    actions: Schema.optional(Schema.Array(PluginSurfaceAction)),
  }),
]);
export type PluginSurfaceCard = typeof PluginSurfaceCard.Type;
export const PluginSurfaceModel = Schema.Struct({
  pluginId: Schema.String,
  navigationId: Schema.String,
  title: Schema.String,
  refreshedAt: Schema.String,
  cards: Schema.Array(PluginSurfaceCard),
});
export type PluginSurfaceModel = typeof PluginSurfaceModel.Type;
export const PluginPanelContribution = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  surface: Schema.Literals(["settings", "project", "thread.sidePanel", "thread.main"]),
});
export const PluginSettingsPanelContribution = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  settingIds: Schema.Array(Schema.String),
});
export type PluginSettingsPanelContribution = typeof PluginSettingsPanelContribution.Type;

export const PluginManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  displayName: Schema.String,
  version: Schema.String,
  runtime: PluginRuntime,
  contributes: Schema.Struct({
    commands: Schema.optional(Schema.Array(PluginCommandContribution)),
    navigation: Schema.optional(Schema.Array(PluginNavigationContribution)),
    settings: Schema.optional(Schema.Array(PluginSettingContribution)),
    settingsPanels: Schema.optional(Schema.Array(PluginSettingsPanelContribution)),
    panels: Schema.optional(Schema.Array(PluginPanelContribution)),
    workflows: Schema.optional(Schema.Array(PluginWorkflowContribution)),
    hooks: Schema.optional(Schema.Array(Schema.String)),
  }),
  capabilities: Schema.Array(PluginCapabilityRequest),
});
export type PluginManifest = typeof PluginManifest.Type;

export const PluginHandshakeRequest = Schema.Struct({
  type: Schema.Literal("plugin.handshake"),
  manifest: PluginManifest,
});
export const PluginHandshakeResponse = Schema.Struct({
  type: Schema.Literal("plugin.handshake.ok"),
  protocolVersion: Schema.Literal(1),
  pluginId: Schema.String,
});
export const PluginHealth = Schema.Struct({
  pluginId: Schema.String,
  state: Schema.Literals(["starting", "healthy", "degraded", "stopped", "crashed"]),
  message: Schema.optional(Schema.String),
});
export type PluginHealth = typeof PluginHealth.Type;

export const PluginInstallInput = Schema.Struct({
  // Raw Git and catalog installs are inspected by the server before activation.
  // Hosts may include a reviewed manifest to avoid a second fetch.
  manifest: Schema.optional(PluginManifest),
  source: PluginPackageSource,
});
export type PluginInstallInput = typeof PluginInstallInput.Type;
export const PluginIdInput = Schema.Struct({ pluginId: Schema.String });
export type PluginIdInput = typeof PluginIdInput.Type;
export const PluginCapabilityGrantInput = Schema.Struct({
  pluginId: Schema.String,
  capability: PluginCapabilityRequest,
});
export type PluginCapabilityGrantInput = typeof PluginCapabilityGrantInput.Type;
export const PluginRegistryEntry = Schema.Struct({
  pluginId: Schema.String,
  displayName: Schema.String,
  version: Schema.String,
  source: PluginInstallInput.fields.source,
  health: PluginHealth,
  capabilities: Schema.Array(PluginCapabilityRequest),
  grants: Schema.Array(PluginCapabilityRequest),
  settings: Schema.Array(PluginSettingContribution),
  settingsPanels: Schema.Array(PluginSettingsPanelContribution),
  navigation: Schema.Array(PluginNavigationContribution),
  panels: Schema.Array(PluginPanelContribution),
  workflows: Schema.Array(PluginWorkflowContribution),
});
export type PluginRegistryEntry = typeof PluginRegistryEntry.Type;

export const PluginRpcRequest = Schema.Struct({
  type: Schema.Literal("plugin.request"),
  requestId: Schema.String,
  method: Schema.String,
  payload: Schema.Unknown,
});
export type PluginRpcRequest = typeof PluginRpcRequest.Type;
export const PluginRpcResponse = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("plugin.response"),
    requestId: Schema.String,
    ok: Schema.Literal(true),
    result: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("plugin.response"),
    requestId: Schema.String,
    ok: Schema.Literal(false),
    error: Schema.String,
  }),
]);
export type PluginRpcResponse = typeof PluginRpcResponse.Type;
