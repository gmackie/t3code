// The pull request lanes .forgejo/workflows/pr-lanes.yml runs from one install (T3CODE-100).
// scripts/run-pr-lanes.ts runs the lanes whose paths a pull request touches; a
// failing command fails its lane, which stops there. Changes to this file, the
// runner or the workflow run every lane.

export interface LaneCommand {
  readonly run: string;
  /** Relative to the repository root. Commands with the same cwd and text run once. */
  readonly cwd?: string;
  /** Runs with nothing else beside it, for timing gates. */
  readonly exclusive?: boolean;
}

export interface Lane {
  readonly id: string;
  /** Base branches the lane runs for (default: custom-local). */
  readonly branches?: ReadonlyArray<string>;
  /** Workflow `paths:` syntax: `*` stays within a directory and `**` crosses them. */
  readonly paths?: ReadonlyArray<string>;
  readonly commands: ReadonlyArray<LaneCommand>;
}

const dependencies = ["pnpm-lock.yaml", "pnpm-workspace.yaml"];

const forgeGraphProviderPaths = [
  "packages/source-control-forgegraph/**",
  "apps/server/src/sourceControl/**",
  "apps/server/src/pullRequest/**",
  "apps/server/src/mcp/toolkits/pullRequests/**",
  // Every MCP tool needs a display definition; core.test.ts checks the whole catalog.
  "apps/server/src/mcp/toolkits/core.test.ts",
  "packages/shared/src/t3McpToolPresentation.ts",
  "packages/client-runtime/src/t3ToolSummary.ts",
  "apps/server/src/mcp/McpHttpServer.test.ts",
  "apps/server/src/ws.ts",
  "apps/server/src/server.ts",
  "apps/server/src/observability/RpcInstrumentation.ts",
  "apps/server/src/auth/RpcAuthorization.test.ts",
  "packages/contracts/src/pullRequest.ts",
  "packages/contracts/src/rpc.ts",
  "packages/contracts/src/forgeGraphSignIn.ts",
  "packages/contracts/src/clientRpcPermissions.ts",
  "packages/shared/src/sourceControl*.ts",
  "packages/client-runtime/src/sourceControlClients*.ts",
  "packages/client-runtime/src/state/sourceControl.ts",
  "apps/web/src/components/settings/ForgeGraphSignInSettings.tsx",
  "apps/web/src/components/settings/SourceControlSettings.tsx",
  "apps/web/src/components/pullRequest/**",
  "apps/web/src/sourceControlPresentation.tsx",
  "apps/mobile/src/features/projects/SourceControlIcon.tsx",
  "apps/mobile/src/features/settings/SettingsServerControlsRouteScreen.tsx",
  "apps/mobile/src/features/settings/forgegraph-sign-in*.ts",
  "apps/mobile/src/features/settings/components/ForgeGraphSignInSection.tsx",
  "apps/web/src/components/CommandPalette.tsx",
  "packages/client-runtime/src/forgeGraphSignIn*.ts",
  ...dependencies,
];
// Pull requests stacked on another T3CODE branch, such as the ones on T3CODE-27's.
const forgeGraphProviderBranches = ["custom-local", "T3CODE-*"];

const forgeGraphProviderLintFiles = `
  packages/source-control-forgegraph/src
  apps/server/src/sourceControl/ForgeGraphSignIn.ts
  apps/server/src/sourceControl/ForgeGraphSignIn.test.ts
  apps/server/src/sourceControl/SourceControlDiscovery.test.ts
  apps/server/src/sourceControl/SourceControlProviderRegistry.test.ts
  apps/server/src/sourceControl/builtInDrivers.ts
  apps/server/src/sourceControl/sourceControlHostSecrets.ts
  apps/server/src/auth/RpcAuthorization.test.ts
  apps/server/src/observability/RpcInstrumentation.ts
  apps/server/src/server.ts
  apps/server/src/ws.ts
  packages/contracts/src/clientRpcPermissions.ts
  packages/contracts/src/forgeGraphSignIn.ts
  packages/contracts/src/pullRequest.ts
  packages/contracts/src/rpc.ts
  packages/shared/src/sourceControl.ts
  packages/client-runtime/src/sourceControlClients.ts
  packages/client-runtime/src/sourceControlClients.test.ts
  packages/client-runtime/src/state/sourceControl.ts
  apps/web/src/components/Icons.tsx
  apps/web/src/components/settings/ForgeGraphSignInSettings.tsx
  apps/web/src/components/settings/SourceControlSettings.tsx
  apps/web/src/components/settings/settingsSearch.ts
  apps/web/src/sourceControlPresentation.tsx
  apps/mobile/src/features/projects/SourceControlIcon.tsx
  apps/server/src/pullRequest/PullRequestService.ts
  apps/server/src/pullRequest/PullRequestService.test.ts
  apps/server/src/mcp/toolkits/pullRequests
  apps/server/src/mcp/McpHttpServer.test.ts
  apps/mobile/src/features/settings/SettingsServerControlsRouteScreen.tsx
  apps/mobile/src/features/settings/forgegraph-sign-in.ts
  apps/mobile/src/features/settings/forgegraph-sign-in.test.ts
  apps/mobile/src/features/settings/components/ForgeGraphSignInSection.tsx
  apps/web/src/components/CommandPalette.tsx
  apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx
  apps/web/src/components/pullRequest/PullRequestThreadConversation.tsx
  apps/web/src/components/pullRequest/pullRequestDetail.logic.ts
  apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts
  packages/client-runtime/src/forgeGraphSignIn.ts
  packages/client-runtime/src/forgeGraphSignIn.test.ts
`;

const agentToolsPaths = [
  "packages/contracts/src/agentTools.ts",
  "packages/contracts/src/settings.ts",
  "packages/shared/src/projectSettings.ts",
  "packages/shared/src/serverSettings.ts",
  "packages/client-runtime/src/providerSkills.ts",
  "packages/provider-core/src/server/mcpSession.ts",
  "packages/provider-acp/src/server/**",
  "packages/provider-acp-registry/src/server/**",
  "packages/provider-cursor/src/server/**",
  "packages/provider-grok/src/server/**",
  "packages/provider-opencode/src/server/**",
  "apps/server/src/mcp/resolveAgentTools.ts",
  "apps/server/src/mcp/McpRemoteAuth.ts",
  "apps/server/src/mcp/mcpRemoteAuthHttp.ts",
  "apps/server/src/server.ts",
  "apps/server/src/ws.ts",
  "packages/contracts/src/rpc.ts",
  "packages/client-runtime/src/state/server.ts",
  "apps/web/src/components/settings/McpOAuthSignIn.tsx",
  "apps/server/src/serverSettings.ts",
  "apps/server/src/settingsSecrets.ts",
  "apps/server/src/auth/RpcAuthorization.ts",
  "apps/server/src/orchestration-v2/ProviderSessionManager.ts",
  "apps/server/src/orchestration-v2/Adapters/**",
  "apps/web/src/components/settings/ToolsSettings.tsx",
  "apps/web/src/components/settings/McpServerDialog.tsx",
  "apps/web/src/components/settings/toolsSettings.logic.ts",
  "apps/web/src/components/chat/useComposerMenuItems.ts",
  "apps/mobile/src/features/threads/use-composer-command-menu.ts",
  ...dependencies,
];

const browserRevealPaths = [
  "apps/desktop/src/app/DesktopConfig.ts",
  "apps/desktop/src/app/DesktopEnvironment*",
  "apps/desktop/src/app/DesktopUserData*",
  "apps/desktop/src/app/DesktopClerk.test.ts",
  "apps/web/src/components/ChatView.tsx",
  "apps/web/src/components/preview/useServerPreviewReveal*",
  "apps/web/src/previewStateStore*",
  "apps/web/src/previewRevealHydration.test.ts",
  ...dependencies,
];

const mcpPluginsPaths = [
  "packages/contracts/src/mcpPlugin.ts",
  "packages/contracts/src/mcpApps.ts",
  "packages/contracts/src/agentTools.ts",
  "packages/contracts/src/rpc.ts",
  "packages/client-runtime/src/mcpApps/**",
  "packages/client-runtime/src/state/mcpApps.ts",
  "apps/server/src/mcp/**",
  "apps/server/src/mcpApps/**",
  "apps/server/src/plugins/McpPlugins*",
  "apps/server/src/orchestration-v2/runtimeLayer.ts",
  "apps/server/src/ws.ts",
  "apps/web/src/components/plugins/**",
  "apps/web/src/components/chat/McpAppFrame.tsx",
  "apps/web/src/components/chat/RightPanelSurfaceContent.tsx",
  "apps/web/src/components/settings/McpPluginsSettings.tsx",
  "apps/web/src/components/settings/ToolsSettings.tsx",
  "apps/web/src/components/CommandPalette*",
  "apps/web/src/rightPanelStore.ts",
  "apps/mobile/src/features/plugins/**",
  "apps/mobile/src/features/tools/mcpOAuthSignIn*",
  "apps/mobile/src/features/threads/McpAppWebView.tsx",
  "apps/mobile/src/features/threads/mcpAppSource*",
  "apps/mobile/src/features/settings/SettingsProjectOverviewRouteScreen.tsx",
  "apps/server/src/server.ts",
  "pnpm-lock.yaml",
];

const routingPaths = [
  "apps/server/src/routing/**",
  "apps/web/src/state/routing.ts",
  "apps/web/src/components/chat/RoutingBadge*",
  "apps/web/src/components/chat/MessagesTimeline*",
  "packages/contracts/src/routing.ts",
  "packages/provider-opencode/src/server/**",
  ...dependencies,
];

const securityKeyNoticePaths = [
  "apps/desktop/src/preview-pick-preload.ts",
  "apps/desktop/src/preview/GuestProtocol.ts",
  "apps/desktop/src/preview/Manager*",
  "apps/desktop/src/preview/Passkey*",
  "apps/desktop/src/preview/SecurityKeyNotice*",
  "apps/desktop/src/window/DesktopWindow*",
  "apps/web/src/components/preview/PreviewView.tsx",
  "apps/web/src/components/preview/SecurityKeyNotice.tsx",
  "apps/web/src/components/preview/usePreviewBridge*",
  "apps/web/src/previewStateStore*",
  "packages/contracts/src/ipc.ts",
  ...dependencies,
];

const systemsModelPaths = [
  "packages/systems-*/**",
  "packages/contracts/src/systems.ts",
  "packages/contracts/src/rpc.ts",
  // The old workflow listed these five on one line, which matched none of them;
  // the two globs below it already covered the presentation and parameter files.
  "packages/client-runtime/src/state/systems.ts",
  "packages/client-runtime/src/systemsPresentation*.ts",
  "packages/client-runtime/src/systemsParameters*.ts",
  "packages/contracts/src/clientRpcPermissions.ts",
  "apps/server/src/auth/RpcAuthorization.ts",
  "apps/server/src/systems/**",
  "apps/server/src/systems-worker.ts",
  "apps/server/src/mcp/toolkits/systems/**",
  "apps/server/src/mcp/McpToolAccess.ts",
  "apps/server/src/persistence/Migrations.ts",
  "apps/web/src/components/systems/**",
  "apps/mobile/src/features/systems/**",
  "apps/mobile/src/state/systems.ts",
  "vite.config.ts",
  "pnpm-lock.yaml",
];

const systemsPackages =
  "packages/systems-model packages/systems-compiler packages/systems-statechart packages/systems-runtime";

const systemsIntegrationLintFiles =
  "apps/server/src/systems apps/server/src/systems-worker.ts apps/server/src/mcp/toolkits/systems apps/web/src/components/systems apps/mobile/src/features/systems apps/mobile/src/state/systems.ts packages/contracts/src/systems.ts packages/client-runtime/src/state/systems.ts packages/client-runtime/src/systemsPresentation.ts packages/client-runtime/src/systemsPresentation.test.ts packages/client-runtime/src/systemsParameters.ts packages/client-runtime/src/systemsParameters.test.ts";

const typecheck = (cwd: string): LaneCommand => ({ cwd, run: "pnpm exec vp run typecheck" });

export const lanes: ReadonlyArray<Lane> = [
  // The nightly preflight runs `vp check` after merge, so a pull request that
  // breaks lint or formatting stops every release until someone repairs the
  // lane. This runs the same check before merge, on every pull request.
  {
    id: "lane-check",
    commands: [
      { run: "node --test scripts/nightly-conflict-session.test.mjs" },
      { run: "pnpm vp check" },
    ],
  },
  // The lane runner itself. Changing it runs every lane as well.
  {
    id: "pr-lanes",
    paths: ["scripts/run-pr-lanes.test.ts"],
    commands: [{ run: "pnpm exec vp test run scripts/run-pr-lanes.test.ts" }],
  },

  // Settings storage, permissions and per-session injection into every adapter.
  {
    id: "agent-tools/server-tools",
    paths: agentToolsPaths,
    commands: [
      {
        run: "pnpm exec vp test run packages/shared/src/projectSettings.test.ts packages/shared/src/serverSettings.test.ts packages/contracts/src/settings.test.ts apps/server/src/auth/RpcAuthorization.test.ts apps/server/src/mcp/McpRemoteAuth.test.ts apps/server/src/mcp/mcpRemoteAuthHttp.test.ts apps/server/src/mcp/resolveAgentTools.test.ts apps/server/src/serverSettings.test.ts apps/server/src/orchestration-v2/ProviderSessionManager.test.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts apps/server/src/orchestration-v2/Adapters/OpenCode2AdapterV2.test.ts apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.test.ts apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.test.ts",
      },
      typecheck("packages/contracts"),
      typecheck("packages/shared"),
      typecheck("apps/server"),
    ],
  },
  // Use the root config like each package's own test script; without it slow
  // tests hit vitest's 5s default. OpenCodeServerLedger's process-group tests
  // fail only in the runner's job container (its PID 1 never reaps exited
  // children), so they're left out.
  {
    id: "agent-tools/provider-packages",
    paths: agentToolsPaths,
    commands: [
      "provider-core",
      "provider-acp",
      "provider-acp-registry",
      "provider-cursor",
      "provider-grok",
      "provider-opencode",
    ].flatMap((pkg) => [
      {
        cwd: `packages/${pkg}`,
        run: "pnpm exec vp test run --config ../../vite.config.ts --dir . --exclude 'src/server/OpenCodeServerLedger.test.ts'",
      },
      typecheck(`packages/${pkg}`),
    ]),
  },
  {
    id: "agent-tools/clients",
    paths: agentToolsPaths,
    commands: [
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/components/settings/toolsSettings.logic.test.ts src/components/settings/settingsSearch.test.ts",
      },
      typecheck("apps/web"),
      {
        cwd: "apps/mobile",
        run: "pnpm exec vp test run src/features/threads/use-composer-command-menu.test.ts",
      },
      typecheck("apps/mobile"),
      { cwd: "packages/client-runtime", run: "pnpm exec vp test run src/providerSkills.test.ts" },
      typecheck("packages/client-runtime"),
      // Lint from the root: oxlint resolves the repo's local plugin relative to it.
      {
        run: "pnpm exec vp lint apps/web/src/components/settings/ToolsSettings.tsx apps/web/src/components/settings/McpServerDialog.tsx apps/web/src/components/settings/McpOAuthSignIn.tsx apps/web/src/components/settings/toolsSettings.logic.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/web/src/components/settings/ToolsSettings.tsx apps/web/src/components/settings/McpServerDialog.tsx apps/web/src/components/settings/McpOAuthSignIn.tsx apps/web/src/components/settings/toolsSettings.logic.ts",
      },
    ],
  },

  {
    id: "autolab-completion",
    paths: [
      "apps/server/src/orchestration-v2/ThreadSettlementService*",
      "apps/server/src/orchestration-v2/ThreadLaunchService*",
      "packages/shared/src/agentAwareness*",
      "apps/web/src/components/ThreadNotificationCoordinator*",
    ],
    commands: [
      {
        run: "pnpm exec vp test run packages/shared/src/agentAwareness.test.ts apps/server/src/orchestration-v2/ThreadSettlementService.test.ts apps/server/src/orchestration-v2/ThreadLaunchService.test.ts",
      },
      {
        run: "pnpm exec vp lint packages/contracts/src/orchestrationV2.ts packages/shared/src/agentAwareness.ts apps/server/src/orchestration-v2/ThreadSettlementService.ts apps/server/src/orchestration-v2/ThreadLaunchService.ts apps/server/src/orchestration-v2/ProjectionStore.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/ws.ts apps/web/src/components/ThreadNotificationCoordinator.tsx",
      },
      { run: "pnpm --filter t3 exec vp pack" },
    ],
  },

  {
    id: "bob-coordination",
    paths: [
      "apps/server/src/coordination/**",
      "apps/server/src/mcp/toolkits/coordination/**",
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/persistence/Migrations/078_BobExecutionAdmission.ts",
      "apps/web/src/components/coordination/**",
      "apps/web/src/state/bobCoordination.ts",
      "apps/web/src/rightPanelStore*",
      "apps/mobile/src/features/work/**",
      "apps/mobile/src/state/bobCoordination.ts",
      "packages/client-runtime/src/state/bobCoordination.ts",
      "packages/contracts/src/bob/**",
      "packages/contracts/src/bobContract.ts",
      "packages/contracts/src/bobCoordination*",
      "scripts/sync-bob-contract.mjs",
      ...dependencies,
    ],
    commands: [
      // ForgeC artifacts.
      { run: "node scripts/sync-bob-contract.mjs --check" },
      // Admission, receipts and project-scoped management.
      {
        run: "pnpm exec vp test run packages/contracts/src/bobCoordination.test.ts apps/server/src/coordination apps/server/src/mcp/toolkits/core.test.ts apps/server/src/mcp/toolkits/coordination apps/server/src/persistence/Migrations/055_OrchestrationV2.test.ts apps/server/src/persistence/Migrations/059_BoundedShellLookups.test.ts apps/server/src/persistence/reconcileV2PreviewMigration.test.ts",
      },
      // The Work panel store.
      { cwd: "apps/web", run: "pnpm exec vp test run src/rightPanelStore.test.ts --project unit" },
      {
        run: "pnpm --filter t3 --filter @t3tools/web --filter @t3tools/mobile --filter @t3tools/contracts exec vp run typecheck",
      },
      {
        run: "pnpm exec vp lint apps/server/src/coordination apps/server/src/mcp/toolkits/coordination apps/web/src/components/coordination apps/mobile/src/features/work",
      },
      {
        run: "pnpm exec vp fmt --check apps/server/src/coordination apps/server/src/mcp/toolkits/coordination apps/web/src/components/coordination apps/mobile/src/features/work packages/contracts/src/bob packages/contracts/src/bobContract.ts packages/contracts/src/bobCoordination.ts",
      },
    ],
  },

  {
    id: "browser-reveal/browser-reveal",
    paths: browserRevealPaths,
    commands: [
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/previewRevealHydration.test.ts src/previewStateStore.test.ts --project unit",
      },
      typecheck("apps/web"),
      {
        cwd: "apps/web",
        run: "pnpm exec vp lint src/previewStateStore.ts src/previewRevealHydration.test.ts src/components/preview/useServerPreviewReveal.ts src/components/preview/useServerPreviewReveal.browser.test.tsx",
      },
      {
        cwd: "apps/web",
        run: "pnpm exec vp fmt --check src/components/ChatView.tsx src/previewStateStore.ts src/previewRevealHydration.test.ts src/components/preview/useServerPreviewReveal.ts src/components/preview/useServerPreviewReveal.browser.test.tsx",
      },
    ],
  },
  {
    id: "browser-reveal/desktop-profile",
    paths: browserRevealPaths,
    commands: [
      {
        cwd: "apps/desktop",
        run: "pnpm exec vp test run src/app/DesktopEnvironment.test.ts src/app/DesktopUserData.test.ts src/app/DesktopAppIdentity.test.ts src/app/DesktopClerk.test.ts",
      },
      typecheck("apps/desktop"),
      {
        cwd: "apps/desktop",
        run: "pnpm exec vp lint src/app/DesktopConfig.ts src/app/DesktopEnvironment.ts src/app/DesktopUserData.ts",
      },
      {
        cwd: "apps/desktop",
        run: "pnpm exec vp fmt --check src/app/DesktopConfig.ts src/app/DesktopEnvironment.ts src/app/DesktopUserData.ts src/app/DesktopEnvironment.test.ts src/app/DesktopUserData.test.ts src/app/DesktopClerk.test.ts",
      },
    ],
  },

  {
    id: "desktop-libs",
    paths: [
      "scripts/build-desktop-artifact.ts",
      "scripts/build-desktop-artifact.test.ts",
      "scripts/lib/desktopElectronBuilderConfig.ts",
      "scripts/lib/desktopAppIdentity.ts",
      "scripts/lib/desktopAppIdentity.test.ts",
      "apps/desktop/scripts/electron-launcher.mjs",
      "knip.jsonc",
    ],
    commands: [
      // The electron-builder config and dev app identity.
      {
        run: "pnpm exec vp test run scripts/build-desktop-artifact.test.ts scripts/lib/desktopAppIdentity.test.ts",
      },
      // The dev Electron launcher.
      { cwd: "apps/desktop", run: "pnpm exec vp test run scripts/electron-launcher.test.mjs" },
      // The export check behind it still reports older unused exports; keep files and dependencies clean.
      { run: "pnpm exec knip --include files,dependencies --no-config-hints" },
    ],
  },

  {
    id: "desktop-preview",
    paths: ["apps/desktop/src/preview/**"],
    commands: [{ cwd: "apps/desktop", run: "pnpm exec vp test run src/preview/" }],
  },

  {
    id: "engine",
    branches: ["custom-local", "T3CODE-41-**"],
    paths: [
      "packages/engine/**",
      "apps/server/src/engine/**",
      "apps/server/scripts/engine-contention-bench.ts",
      "packages/contracts/src/engineRpc.ts",
      "vite.config.ts",
    ],
    commands: [
      { run: "pnpm exec vp test run packages/engine apps/server/src/engine" },
      { run: "pnpm --filter @t3tools/engine exec vp run typecheck" },
      { run: "pnpm --filter t3 exec vp run typecheck" },
      { run: "pnpm --filter @t3tools/contracts exec vp run typecheck" },
      {
        run: "pnpm exec vp lint packages/engine apps/server/src/engine apps/server/scripts/engine-contention-bench.ts vite.config.ts",
      },
      // Contention gate (engine writes vs V2 commits). The gate allows no excess
      // latency, so it runs alone; a real regression fails every attempt.
      {
        exclusive: true,
        run: `for attempt in 1 2 3; do
  node apps/server/scripts/engine-contention-bench.ts --commits 1000 --reps 5 && exit 0
  echo "::warning::contention gate attempt $attempt failed"
done
exit 1`,
      },
    ],
  },

  // One lane per concern, so a failure names the suite.
  {
    id: "forgegraph-provider/provider-package",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      {
        cwd: "packages/source-control-forgegraph",
        run: "pnpm exec vp test run --config ../../vite.config.ts --dir . src",
      },
      typecheck("packages/source-control-forgegraph"),
    ],
  },
  {
    id: "forgegraph-provider/shared-and-client-runtime",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      {
        cwd: "packages/client-runtime",
        run: "pnpm exec vp test run src/sourceControlClients.test.ts src/forgeGraphSignIn.test.ts",
      },
    ],
  },
  {
    id: "forgegraph-provider/server-tests",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      {
        cwd: "apps/server",
        run: "pnpm exec vp test run src/sourceControl/ForgeGraphSignIn.test.ts src/sourceControl/SourceControlDiscovery.test.ts src/sourceControl/SourceControlProviderRegistry.test.ts src/auth/RpcAuthorization.test.ts src/pullRequest/PullRequestService.test.ts src/mcp/toolkits/pullRequests src/mcp/McpHttpServer.test.ts src/mcp/toolkits/core.test.ts",
      },
    ],
  },
  {
    id: "forgegraph-provider/server-typecheck",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [typecheck("apps/server")],
  },
  {
    id: "forgegraph-provider/web",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/components/pullRequest/pullRequestDetail.logic.test.ts src/components/CommandPalette.logic.test.ts --project unit",
      },
      typecheck("apps/web"),
    ],
  },
  {
    id: "forgegraph-provider/mobile",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      {
        cwd: "apps/mobile",
        run: "pnpm exec vp test run src/features/settings/forgegraph-sign-in.test.ts",
      },
      typecheck("apps/mobile"),
    ],
  },
  {
    id: "forgegraph-provider/lint",
    branches: forgeGraphProviderBranches,
    paths: forgeGraphProviderPaths,
    commands: [
      { run: `FILES="${forgeGraphProviderLintFiles}"\npnpm exec vp lint $FILES` },
      { run: `FILES="${forgeGraphProviderLintFiles}"\npnpm exec vp fmt --check $FILES` },
    ],
  },

  {
    id: "knip-entries",
    paths: [
      "knip.jsonc",
      "apps/server/package.json",
      "scripts/lib/cli-external-packages.ts",
      "apps/web/src/components/chat/ChatHeader.tsx",
      "apps/web/src/components/plugins/PluginQuickNav.tsx",
      "pnpm-lock.yaml",
    ],
    commands: [
      // External CLI packages must not drag in dependencies the bundle would inline.
      { run: "pnpm exec vp test run scripts/lib/cli-external-packages.test.ts" },
      // The chat header with plugin quick nav.
      { cwd: "apps/web", run: "pnpm exec vp test run src/components/chat --project unit" },
      typecheck("apps/web"),
      {
        run: "pnpm exec vp lint apps/web/src/components/chat/ChatHeader.tsx apps/web/src/components/plugins/PluginQuickNav.tsx",
      },
      {
        run: "pnpm exec vp fmt --check knip.jsonc apps/web/src/components/chat/ChatHeader.tsx apps/web/src/components/plugins/PluginQuickNav.tsx",
      },
    ],
  },

  // The pool, thread-less panels, plugin lifecycle and the T3 tool allowlist.
  {
    id: "mcp-plugins/server",
    paths: mcpPluginsPaths,
    commands: [
      {
        run: "pnpm exec vp test run apps/server/src/mcp apps/server/src/mcpApps apps/server/src/plugins/McpPlugins.test.ts apps/server/src/peer apps/server/src/ws.test.ts apps/server/src/auth/RpcAuthorization.test.ts apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts",
      },
      { run: "pnpm exec vp test run packages/contracts/src" },
      typecheck("packages/contracts"),
      typecheck("apps/server"),
    ],
  },
  {
    id: "mcp-plugins/clients",
    paths: mcpPluginsPaths,
    commands: [
      { cwd: "packages/client-runtime", run: "pnpm exec vp test run src/mcpApps" },
      typecheck("packages/client-runtime"),
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/components/CommandPalette.logic.test.ts src/rightPanelStore.test.ts src/components/RightPanelTabs.test.tsx src/components/settings --project unit",
      },
      typecheck("apps/web"),
      {
        cwd: "apps/mobile",
        run: "pnpm exec vp test run src/features/plugins src/features/threads/mcpAppSource.test.ts src/features/tools/mcpOAuthSignIn.test.ts",
      },
      {
        cwd: "apps/mobile",
        run: "T3_MOBILE_TEST_PLATFORM=android pnpm exec vp test run --project react src/features/plugins/PluginPanelScreen.test.tsx",
      },
      typecheck("apps/mobile"),
      {
        run: "pnpm exec vp lint apps/web/src/components/plugins apps/web/src/components/settings/McpPluginsSettings.tsx apps/web/src/components/chat/McpAppFrame.tsx apps/server/src/mcp/McpClientPool.ts apps/server/src/plugins/McpPlugins.ts apps/server/src/mcpApps",
      },
      {
        run: "pnpm exec vp fmt --check apps/web/src/components/plugins apps/web/src/components/settings/McpPluginsSettings.tsx apps/web/src/components/chat/McpAppFrame.tsx apps/server/src/mcp/McpClientPool.ts apps/server/src/plugins/McpPlugins.ts apps/server/src/mcpApps",
      },
    ],
  },

  {
    id: "migration-ledger",
    paths: [
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/persistence/Migrations.test.ts",
      "apps/server/src/persistence/Migrations/**",
      "apps/server/scripts/migrate-dev-db.ts",
      "apps/server/scripts/migrate-dev-db.test.ts",
      ...dependencies,
    ],
    commands: [
      {
        cwd: "apps/server",
        run: "pnpm exec vp test run src/persistence/Migrations.test.ts scripts/migrate-dev-db.test.ts",
      },
      typecheck("apps/server"),
      {
        run: "pnpm exec vp lint apps/server/src/persistence/Migrations.ts apps/server/src/persistence/Migrations.test.ts apps/server/scripts/migrate-dev-db.ts apps/server/scripts/migrate-dev-db.test.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/server/src/persistence/Migrations.ts apps/server/src/persistence/Migrations.test.ts apps/server/scripts/migrate-dev-db.ts apps/server/scripts/migrate-dev-db.test.ts",
      },
    ],
  },

  // The server's Happy Eyeballs budget for networks without working IPv6 (T3CODE-29).
  {
    id: "network-family",
    paths: [
      "apps/server/src/networkFamilyAutoselection*.ts",
      "apps/server/src/cli/server.ts",
      ...dependencies,
    ],
    commands: [
      {
        cwd: "apps/server",
        run: "pnpm exec vp test run src/networkFamilyAutoselection.test.ts",
      },
      typecheck("apps/server"),
      {
        run: "pnpm exec vp lint apps/server/src/networkFamilyAutoselection.ts apps/server/src/networkFamilyAutoselection.test.ts apps/server/src/cli/server.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/server/src/networkFamilyAutoselection.ts apps/server/src/networkFamilyAutoselection.test.ts apps/server/src/cli/server.ts",
      },
    ],
  },

  {
    id: "pair",
    paths: [
      "apps/server/src/cli/pair.ts",
      "apps/server/src/cli/pair.test.ts",
      "apps/server/src/startupAccess.ts",
      ...dependencies,
    ],
    commands: [
      { cwd: "apps/server", run: "pnpm exec vp test run src/cli/pair.test.ts" },
      typecheck("apps/server"),
      {
        run: "pnpm exec vp lint apps/server/src/cli/pair.ts apps/server/src/cli/pair.test.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/server/src/cli/pair.ts apps/server/src/cli/pair.test.ts",
      },
    ],
  },

  {
    id: "routing/server-routing",
    paths: routingPaths,
    commands: [
      { cwd: "apps/server", run: "pnpm exec vp test run src/routing" },
      typecheck("apps/server"),
      { run: "pnpm exec vp lint apps/server/src/routing" },
      { run: "pnpm exec vp fmt --check apps/server/src/routing" },
    ],
  },
  {
    id: "routing/web-routing",
    paths: routingPaths,
    commands: [
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/components/chat/RoutingBadge.logic.test.ts src/components/chat/MessagesTimeline --project unit",
      },
      typecheck("apps/web"),
      {
        run: "pnpm exec vp lint apps/web/src/components/chat/RoutingBadge.tsx apps/web/src/components/chat/RoutingBadge.logic.ts apps/web/src/components/chat/MessagesTimeline.logic.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/web/src/state/routing.ts apps/web/src/components/chat/RoutingBadge.tsx apps/web/src/components/chat/RoutingBadge.logic.ts apps/web/src/components/chat/RoutingBadge.logic.test.ts apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/chat/MessagesTimeline.logic.ts",
      },
    ],
  },
  // Pistache threads run through OpenCode; its adapter decides how their turns
  // end. Only the adapter tests: the package's process-group tests need a PID 1
  // that reaps orphans, and its large-history usage test times out on the
  // shared runner.
  {
    id: "routing/opencode-adapter",
    paths: routingPaths,
    commands: [
      {
        cwd: "packages/provider-opencode",
        run: "pnpm exec vp test run --config ../../vite.config.ts --dir . src/server/adapter.test.ts",
      },
      { cwd: "packages/provider-opencode", run: "pnpm typecheck" },
      { run: "pnpm exec vp lint packages/provider-opencode/src/server" },
      { run: "pnpm exec vp fmt --check packages/provider-opencode/src/server" },
    ],
  },

  {
    id: "security-key-notice/desktop",
    paths: securityKeyNoticePaths,
    commands: [
      {
        cwd: "apps/desktop",
        run: "pnpm exec vp test run src/preview/SecurityKeyNotice.test.ts src/preview/Passkeys.test.ts src/preview/PasskeyBridge.test.ts src/preview/Manager.test.ts src/window/DesktopWindow.test.ts",
      },
      typecheck("apps/desktop"),
      {
        cwd: "apps/desktop",
        run: "pnpm exec vp lint src/preview-pick-preload.ts src/preview/GuestProtocol.ts src/preview/Manager.ts src/preview/Passkeys.ts src/preview/SecurityKeyNotice.ts src/window/DesktopWindow.ts",
      },
    ],
  },
  {
    id: "security-key-notice/web",
    paths: securityKeyNoticePaths,
    commands: [
      {
        cwd: "apps/web",
        run: "pnpm exec vp test run src/previewStateStore.test.ts src/components/preview/usePreviewBridge.test.ts --project unit",
      },
      typecheck("apps/web"),
      {
        cwd: "apps/web",
        run: "pnpm exec vp lint src/components/preview/SecurityKeyNotice.tsx src/components/preview/PreviewView.tsx src/components/preview/usePreviewBridge.ts src/previewStateStore.ts",
      },
    ],
  },

  {
    id: "server-browser",
    paths: [
      "apps/server/src/preview/PreviewBrowser*",
      "apps/server/src/preview/ServerBrowser*",
      "apps/server/src/cli/browser.ts",
      "apps/server/src/htmlRender/headlessChrome.ts",
      "apps/server/src/zipArchive.ts",
      ...dependencies,
    ],
    commands: [
      {
        cwd: "apps/server",
        run: "pnpm exec vp test run src/preview/PreviewBrowser.test.ts src/preview/PreviewBrowserHost.test.ts src/preview/ServerBrowserContexts.test.ts src/preview/ServerBrowser.test.ts",
      },
      typecheck("apps/server"),
      {
        run: "pnpm exec vp lint apps/server/src/preview apps/server/src/cli/browser.ts apps/server/src/htmlRender/headlessChrome.ts",
      },
      {
        run: "pnpm exec vp fmt --check apps/server/src/preview apps/server/src/cli/browser.ts apps/server/src/htmlRender/headlessChrome.ts",
      },
    ],
  },

  {
    id: "systems-model/systems",
    paths: systemsModelPaths,
    commands: [
      // Model schemas against the conformance fixtures.
      { run: "pnpm exec vp test run packages/systems-model" },
      { run: "pnpm --filter @t3tools/systems-model exec vp run typecheck" },
      // Compile and digest the conformance fixtures.
      { run: "pnpm exec vp test run packages/systems-compiler" },
      { run: "pnpm --filter @t3tools/systems-compiler exec vp run typecheck" },
      // Execute the statechart conformance fixtures.
      { run: "pnpm exec vp test run packages/systems-statechart" },
      { run: "pnpm --filter @t3tools/systems-statechart exec vp run typecheck" },
      // Simulate the conformance fixtures.
      { run: "pnpm exec vp test run packages/systems-runtime" },
      { run: "pnpm --filter @t3tools/systems-runtime exec vp run typecheck" },
      { run: `pnpm exec vp lint ${systemsPackages}` },
      { run: `pnpm exec vp fmt --check ${systemsPackages}` },
    ],
  },
  {
    id: "systems-model/systems-integration",
    paths: systemsModelPaths,
    commands: [
      // The Systems service, agent toolkit and migration ledger.
      {
        run: "pnpm exec vp test run apps/server/src/systems apps/server/src/mcp/toolkits/systems apps/server/src/mcp/McpToolAccess.test.ts apps/server/src/persistence/Migrations.test.ts apps/server/src/persistence/reconcileV2PreviewMigration.test.ts",
      },
      {
        run: "pnpm exec vp test run packages/client-runtime/src/systemsPresentation.test.ts packages/client-runtime/src/systemsParameters.test.ts apps/server/src/auth/RpcAuthorization.test.ts apps/web/src/rightPanelStore.test.ts apps/mobile/src/features/systems/systemsPath.test.ts apps/mobile/src/features/systems/tracePages.test.ts",
      },
      // The server, contracts and clients.
      { run: "pnpm --filter t3 exec vp run typecheck" },
      { run: "pnpm --filter @t3tools/contracts exec vp run typecheck" },
      { run: "pnpm --filter @t3tools/client-runtime exec vp run typecheck" },
      typecheck("apps/web"),
      { run: "pnpm --filter @t3tools/mobile exec vp run typecheck" },
      { run: `pnpm exec vp lint ${systemsIntegrationLintFiles}` },
      { run: `pnpm exec vp fmt --check ${systemsIntegrationLintFiles}` },
    ],
  },
];
