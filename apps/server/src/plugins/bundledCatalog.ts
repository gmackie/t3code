// Bundled release manifests are available for review before activation.
import type { PluginManifest, PluginPackageSource } from "@t3tools/contracts";

export type BundledPlugin = {
  readonly manifest: PluginManifest;
  readonly source: PluginPackageSource;
};

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.bizpulse",
      displayName: "BizPulse portfolio operations",
      version: "0.3.0",
      runtime: {
        kind: "managed-app",
        command: ["bizpulse-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "bizpulse.portfolio",
            title: "Portfolio",
            path: "/",
          },
          {
            id: "bizpulse.startups",
            title: "Startups",
            path: "/startups",
          },
          {
            id: "bizpulse.growth",
            title: "Growth",
            path: "/growth",
          },
          {
            id: "bizpulse.crm",
            title: "CRM",
            path: "/crm",
          },
          {
            id: "bizpulse.actions",
            title: "Actions",
            path: "/actions",
          },
        ],
        panels: [
          {
            id: "bizpulse.portfolio",
            title: "Portfolio pulse",
            surface: "project",
          },
          {
            id: "bizpulse.crm",
            title: "CRM follow-ups",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "bizpulse.portfolio-review",
            title: "Portfolio review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "bizpulse.startup",
            title: "Startup id",
            scope: "project",
            field: {
              kind: "text",
              placeholder: "startup id",
            },
          },
          {
            id: "bizpulse.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "bizpulse.connection",
            title: "BizPulse",
            description: "Monitor startup health, growth evidence, and CRM follow-ups.",
            settingIds: ["bizpulse.startup", "bizpulse.polling-seconds"],
          },
        ],
        hooks: ["turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "network.connect",
          hosts: ["bizpulse.forgegraf.com"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel", "thread.main"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-bizpulse-plugin.git",
      commit: "5127ba5477eda042bea08fc13afea9f9e8fd8341",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.bob",
      displayName: "Bob",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["bob-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "bob.workspace",
            title: "Bob planning",
            surface: "project",
          },
          {
            id: "bob.runs",
            title: "Bob runs",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "bob.planning-review",
            title: "Planning review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "bob.api-endpoint",
            title: "Bob API endpoint",
            scope: "server",
            field: {
              kind: "text",
              placeholder: "https://bob.example",
            },
          },
          {
            id: "bob.api-token",
            title: "Bob API token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "bob.linear-endpoint",
            title: "Linear-compatible endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://api.linear.app",
              placeholder: "https://kanbanger.example/graphql",
            },
          },
          {
            id: "bob.linear-token",
            title: "Linear-compatible API token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "bob.linear-workspace",
            title: "Linear-compatible workspace",
            scope: "server",
            field: {
              kind: "text",
              placeholder: "workspace-id",
            },
          },
          {
            id: "bob.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "bob.integrations",
            title: "Bob integrations",
            description:
              "Bob owns Bob, Linear, and KanBanger authentication, polling, and link state.",
            settingIds: [
              "bob.api-endpoint",
              "bob.api-token",
              "bob.linear-endpoint",
              "bob.linear-token",
              "bob.linear-workspace",
              "bob.polling-seconds",
            ],
          },
        ],
        hooks: ["project.opened", "thread.created", "thread.completed"],
      },
      capabilities: [
        {
          kind: "threads.read",
          projectIds: [],
        },
        {
          kind: "threads.dispatch",
          projectIds: [],
        },
        {
          kind: "secrets.read",
          names: ["BOB_API_KEY", "LINEAR_API_KEY"],
        },
        {
          kind: "network.connect",
          hosts: ["*"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-bob-plugin.git",
      commit: "405bb5faa287da6ff04f52e8c364606bf952e00d",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.creator",
      displayName: "Creator command center",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["creator-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "creator.command-center",
            title: "Command center",
            path: "/",
          },
          {
            id: "creator.ideas",
            title: "Ideas",
            path: "/ideas",
          },
          {
            id: "creator.production",
            title: "Production",
            path: "/production",
          },
          {
            id: "creator.publishing",
            title: "Publishing",
            path: "/publishing",
          },
          {
            id: "creator.analytics",
            title: "Analytics",
            path: "/analytics",
          },
          {
            id: "creator.sponsors",
            title: "Sponsors",
            path: "/sponsors",
          },
          {
            id: "creator.library",
            title: "Media library",
            path: "/library",
          },
        ],
        panels: [
          {
            id: "creator.command-center",
            title: "Creator command center",
            surface: "project",
          },
          {
            id: "creator.publish-checks",
            title: "Publish checks",
            surface: "thread.sidePanel",
          },
          {
            id: "creator.publish-queue",
            title: "Publish queue",
            surface: "project",
          },
          {
            id: "creator.content-calendar",
            title: "Content calendar",
            surface: "project",
          },
          {
            id: "creator.analytics",
            title: "Creator analytics",
            surface: "project",
          },
          {
            id: "creator.idea-ladder",
            title: "Idea ladder",
            surface: "project",
          },
          {
            id: "creator.sponsors",
            title: "Sponsor deal room",
            surface: "project",
          },
          {
            id: "creator.package-review",
            title: "Package review",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "creator.video-readiness",
            title: "Video readiness review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "creator.workspace",
            title: "Creator workspace",
            scope: "server",
            field: {
              kind: "text",
            },
          },
          {
            id: "creator.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "creator.connection",
            title: "Creator",
            description:
              "Connect T3 Code to the Creator OS command center for ideas, production, publishing, analytics, sponsors, and media operations.",
            settingIds: ["creator.workspace", "creator.polling-seconds"],
          },
        ],
        hooks: ["turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "network.connect",
          hosts: ["creator.forgegraf.com", "www.googleapis.com", "youtube.googleapis.com"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel", "thread.main"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-creator-plugin.git",
      commit: "7e0bf79e9d501725249f8cff2c0eebd00ac5a608",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.fabforge",
      displayName: "FabForge manufacturing IDE",
      version: "0.3.0",
      runtime: {
        kind: "managed-app",
        command: ["fabforge-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "fabforge.projects",
            title: "Projects",
            path: "/projects",
          },
          {
            id: "fabforge.printing",
            title: "3D printing",
            path: "/printing",
          },
          {
            id: "fabforge.laser",
            title: "Laser cutting",
            path: "/laser",
          },
          {
            id: "fabforge.plasma",
            title: "Plasma cutting",
            path: "/plasma",
          },
          {
            id: "fabforge.cnc",
            title: "CNC",
            path: "/cnc",
          },
          {
            id: "fabforge.materials",
            title: "Materials",
            path: "/materials",
          },
          {
            id: "fabforge.machines",
            title: "Machines",
            path: "/machines",
          },
          {
            id: "fabforge.work-orders",
            title: "Work orders",
            path: "/work-orders",
          },
          {
            id: "fabforge.kit-runs",
            title: "Kit runs",
            path: "/kit-runs",
          },
          {
            id: "fabforge.evidence",
            title: "Evidence",
            path: "/evidence",
          },
        ],
        panels: [
          {
            id: "fabforge.projects",
            title: "Fabrication projects",
            surface: "project",
          },
          {
            id: "fabforge.kit-runs",
            title: "Kit-run serial console",
            surface: "thread.sidePanel",
          },
          {
            id: "fabforge.job-verification",
            title: "Job verification",
            surface: "thread.main",
          },
        ],
        workflows: [
          {
            id: "fabforge.job-review",
            title: "Manufacturing job review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "fabforge.endpoint",
            title: "FabForge endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://fabforge.forgegraf.com",
            },
          },
          {
            id: "fabforge.token",
            title: "FabForge token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "fabforge.workspace",
            title: "Workspace id",
            scope: "server",
            field: {
              kind: "text",
            },
          },
          {
            id: "fabforge.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "fabforge.connection",
            title: "FabForge",
            description:
              "A manufacturing IDE for 3D printing, laser/plasma cutting, CNC, materials, machine state, and production evidence.",
            settingIds: [
              "fabforge.endpoint",
              "fabforge.token",
              "fabforge.workspace",
              "fabforge.polling-seconds",
            ],
          },
        ],
        hooks: ["turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "secrets.read",
          names: ["FABFORGE_TOKEN"],
        },
        {
          kind: "network.connect",
          hosts: ["fabforge.forgegraf.com"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel", "thread.main"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-fabforge-plugin.git",
      commit: "23a96040e64c6357208b2b6ef830bfd07da36fe7",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.forgegraph",
      displayName: "ForgeGraph delivery tracking",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["forgegraph-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "forgegraph.overview",
            title: "Overview",
            path: "/",
          },
          {
            id: "forgegraph.changes",
            title: "Changes",
            path: "/changes",
          },
          {
            id: "forgegraph.checks",
            title: "Checks",
            path: "/checks",
          },
          {
            id: "forgegraph.deployments",
            title: "Deployments",
            path: "/deployments",
          },
          {
            id: "forgegraph.environments",
            title: "Environments",
            path: "/environments",
          },
          {
            id: "forgegraph.releases",
            title: "Releases",
            path: "/releases",
          },
        ],
        panels: [
          {
            id: "forgegraph.changes",
            title: "Pull requests and changesets",
            surface: "project",
          },
          {
            id: "forgegraph.deployments",
            title: "Deployments",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "forgegraph.delivery-review",
            title: "Delivery review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "forgegraph.endpoint",
            title: "ForgeGraph endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://git.forgegraf.com",
              placeholder: "https://forgegraph.example",
            },
          },
          {
            id: "forgegraph.token",
            title: "ForgeGraph token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "forgegraph.app",
            title: "App slug",
            scope: "project",
            field: {
              kind: "text",
              placeholder: "my-app",
            },
          },
          {
            id: "forgegraph.polling-seconds",
            title: "Refresh interval",
            description: "How often delivery status is refreshed while the plugin is active.",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "forgegraph.connection",
            title: "ForgeGraph",
            description:
              "Track PR checks, changesets, deployments, and health from the delivery graph.",
            settingIds: [
              "forgegraph.endpoint",
              "forgegraph.token",
              "forgegraph.app",
              "forgegraph.polling-seconds",
            ],
          },
        ],
        hooks: ["thread.created", "turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "secrets.read",
          names: ["FORGEGRAPH_TOKEN"],
        },
        {
          kind: "network.connect",
          hosts: ["git.forgegraf.com"],
        },
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "events.read",
          eventTypes: ["thread.created", "turn.settled", "runtime.error"],
          projectIds: [],
        },
        {
          kind: "threads.read",
          projectIds: [],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-forgegraph-plugin.git",
      commit: "616bc665f18c655d3d456a542c2b6155a22428a2",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.gitbutler",
      displayName: "GitButler source control",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["gitbutler-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "gitbutler.status",
            title: "Source control",
            surface: "project",
          },
        ],
        commands: [
          {
            id: "gitbutler.refresh",
            title: "Refresh GitButler status",
          },
        ],
      },
      capabilities: [
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "filesystem.write",
          roots: ["project.root"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-gitbutler-plugin.git",
      commit: "9425f5d92c6cc7d39cff1ec4abf8542a02261d10",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.github",
      displayName: "GitHub workflow and pull requests",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["github-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "github.checks",
            title: "Pull request checks",
            surface: "thread.sidePanel",
          },
          {
            id: "github.waitpoints",
            title: "GitHub waits",
            surface: "thread.main",
          },
        ],
        workflows: [
          {
            id: "github.pull-request-review",
            title: "Pull request review",
            surface: "thread.main",
          },
        ],
        hooks: ["thread.created", "turn.settled"],
      },
      capabilities: [
        {
          kind: "events.read",
          eventTypes: ["turn.settled", "thread.created"],
        },
        {
          kind: "threads.read",
        },
        {
          kind: "threads.dispatch",
        },
        {
          kind: "network.connect",
          hosts: ["api.github.com"],
        },
        {
          kind: "ui.embed",
          surfaces: ["thread.sidePanel", "thread.main"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-github-plugin.git",
      commit: "6415faa72d69f9048934548fd48f109c1327818f",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.jujutsu",
      displayName: "Jujutsu",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["t3code-jujutsu-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "jujutsu.command-center",
            title: "Jujutsu",
            path: "/",
          },
          {
            id: "jujutsu.change-graph",
            title: "Change graph",
            path: "/changes",
          },
          {
            id: "jujutsu.operation-log",
            title: "Operation log",
            path: "/operations",
          },
          {
            id: "jujutsu.bookmarks",
            title: "Bookmarks",
            path: "/bookmarks",
          },
          {
            id: "jujutsu.workspaces",
            title: "Workspaces",
            path: "/workspaces",
          },
          {
            id: "jujutsu.conflicts",
            title: "Conflicts",
            path: "/conflicts",
          },
        ],
        panels: [
          {
            id: "jujutsu.command-center",
            title: "Jujutsu command center",
            surface: "project",
          },
          {
            id: "jujutsu.change-graph",
            title: "Change graph",
            surface: "project",
          },
          {
            id: "jujutsu.operation-log",
            title: "Operation log",
            surface: "project",
          },
          {
            id: "jujutsu.bookmarks",
            title: "Bookmarks",
            surface: "project",
          },
          {
            id: "jujutsu.workspaces",
            title: "Workspaces",
            surface: "project",
          },
          {
            id: "jujutsu.conflicts",
            title: "Conflicts",
            surface: "thread.sidePanel",
          },
        ],
        settings: [
          {
            id: "jujutsu.project-root",
            title: "Project root",
            scope: "project",
            field: {
              kind: "text",
            },
          },
          {
            id: "jujutsu.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 30,
              min: 10,
              max: 3600,
              step: 10,
            },
          },
        ],
        settingsPanels: [
          {
            id: "jujutsu.connection",
            title: "Jujutsu",
            description:
              "Observe Jujutsu repositories through a dedicated change graph and operation cockpit.",
            settingIds: ["jujutsu.project-root", "jujutsu.polling-seconds"],
          },
        ],
        hooks: ["project.opened", "project.changed", "runtime.error"],
      },
      capabilities: [
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "filesystem.write",
          roots: ["project.root"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-jujutsu-plugin.git",
      commit: "2356ccdda631f99e795dfce91861a8a36bdb6734",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.kimi",
      displayName: "Kimi Code ACP provider",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["kimi", "acp"],
        restart: "on-failure",
      },
      contributes: {
        settings: [
          {
            id: "kimi.binary",
            title: "Kimi binary path",
            scope: "server",
            field: {
              kind: "text",
              default: "kimi",
              placeholder: "kimi",
            },
          },
          {
            id: "kimi.thinking-level",
            title: "Thinking level",
            scope: "server",
            field: {
              kind: "select",
              default: "medium",
              options: [
                {
                  value: "off",
                  label: "Off",
                },
                {
                  value: "low",
                  label: "Low",
                },
                {
                  value: "medium",
                  label: "Medium",
                },
                {
                  value: "high",
                  label: "High",
                },
              ],
            },
          },
        ],
        settingsPanels: [
          {
            id: "kimi.settings",
            title: "Kimi",
            description: "Configure the Kimi ACP runtime.",
            settingIds: ["kimi.binary", "kimi.thinking-level"],
          },
        ],
      },
      capabilities: [
        {
          kind: "provider.control",
        },
        {
          kind: "secrets.read",
          names: ["KIMI_API_KEY"],
        },
        {
          kind: "network.connect",
          hosts: ["api.moonshot.cn"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-kimi-plugin.git",
      commit: "cb296dea6e43ce21cea950ba72be8299598d5485",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.linear",
      displayName: "Linear",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["linear-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "linear.issues",
            title: "Linear issues",
            surface: "project",
          },
        ],
        workflows: [
          {
            id: "linear.issue-review",
            title: "Issue review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "linear.endpoint",
            title: "Linear-compatible endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://api.linear.app",
              placeholder: "https://kanbanger.example/graphql",
            },
          },
          {
            id: "linear.api-token",
            title: "API token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "linear.workspace",
            title: "Workspace",
            scope: "server",
            field: {
              kind: "text",
              placeholder: "workspace-id",
            },
          },
          {
            id: "linear.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "linear.connection",
            title: "Linear connection",
            description: "Works with Linear and compatible Kanbanger GraphQL endpoints.",
            settingIds: [
              "linear.endpoint",
              "linear.api-token",
              "linear.workspace",
              "linear.polling-seconds",
            ],
          },
        ],
        hooks: ["project.opened", "thread.created"],
      },
      capabilities: [
        {
          kind: "secrets.read",
          names: ["LINEAR_API_KEY"],
        },
        {
          kind: "network.connect",
          hosts: ["api.linear.app"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project"],
        },
        {
          kind: "threads.read",
          projectIds: [],
        },
        {
          kind: "threads.dispatch",
          projectIds: [],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-linear-plugin.git",
      commit: "b24ef7d9ed819e4e0daf8194e3d637a0070dbcce",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.mcp-inventory",
      displayName: "MCP server inventory",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["mcp-inventory-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "mcp.inventory",
            title: "MCP servers",
            surface: "project",
          },
        ],
        settings: [
          {
            id: "mcp.inventory.sources",
            title: "MCP configuration sources",
            scope: "server",
            field: {
              kind: "text",
              default: "project,user",
              placeholder: "project,user",
            },
          },
        ],
        settingsPanels: [
          {
            id: "mcp.inventory.settings",
            title: "MCP inventory",
            description: "Choose which configuration layers the inventory scans.",
            settingIds: ["mcp.inventory.sources"],
          },
        ],
        commands: [
          {
            id: "mcp.inventory.refresh",
            title: "Refresh MCP inventory",
          },
        ],
      },
      capabilities: [
        {
          kind: "filesystem.read",
          roots: ["project.root", "user.config.mcp"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-mcp-inventory-plugin.git",
      commit: "9b63472eeebe998794b8525c4f6bd639938d2430",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.pi-events",
      displayName: "Lifecycle status and notifications",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["pi-events-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "pi-events.status",
            title: "Lifecycle status",
            surface: "thread.sidePanel",
          },
        ],
        settings: [
          {
            id: "pi-events.webhook",
            title: "Notification webhook",
            scope: "server",
            field: {
              kind: "text",
              placeholder: "https://example.test/webhook",
            },
          },
        ],
        settingsPanels: [
          {
            id: "pi-events.settings",
            title: "Pi events",
            description: "Configure lifecycle notifications.",
            settingIds: ["pi-events.webhook"],
          },
        ],
        commands: [
          {
            id: "pi-events.test",
            title: "Send test notification",
          },
        ],
        hooks: ["server.ready", "session.started", "turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "events.read",
          eventTypes: ["server.ready", "session.started", "turn.settled", "runtime.error"],
        },
        {
          kind: "ui.embed",
          surfaces: ["thread.sidePanel"],
        },
        {
          kind: "network.connect",
          hosts: [],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-pi-events-plugin.git",
      commit: "4c9c19b0785b3a448724e6382d64bd6d1341e73a",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.preflight",
      displayName: "Preflight release cockpit",
      version: "0.2.0",
      runtime: {
        kind: "managed-app",
        command: ["preflight-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "preflight.apps",
            title: "Apps",
            path: "/apps",
          },
          {
            id: "preflight.cockpit",
            title: "Cockpit",
            path: "/cockpit",
          },
          {
            id: "preflight.builds",
            title: "Builds",
            path: "/builds",
          },
          {
            id: "preflight.proof",
            title: "Proof",
            path: "/proof",
          },
          {
            id: "preflight.releases",
            title: "Releases",
            path: "/releases",
          },
          {
            id: "preflight.runners",
            title: "Runners",
            path: "/runners",
          },
        ],
        panels: [
          {
            id: "preflight.readiness",
            title: "App readiness",
            surface: "project",
          },
          {
            id: "preflight.releases",
            title: "Release status",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "preflight.release-review",
            title: "Release review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "preflight.endpoint",
            title: "Preflight endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://preflight.forgegraf.com",
            },
          },
          {
            id: "preflight.token",
            title: "Preflight token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "preflight.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
        ],
        settingsPanels: [
          {
            id: "preflight.connection",
            title: "Preflight",
            description: "Track app builds, validation, and release readiness.",
            settingIds: ["preflight.endpoint", "preflight.token", "preflight.polling-seconds"],
          },
        ],
        hooks: ["turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "secrets.read",
          names: ["PREFLIGHT_TOKEN"],
        },
        {
          kind: "network.connect",
          hosts: ["preflight.forgegraf.com"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-preflight-plugin.git",
      commit: "dd1a7d124a3c7e2573e55855e9e91e3956e37935",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.sentry",
      displayName: "Sentry agent monitoring",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["sentry-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        panels: [
          {
            id: "sentry.trace",
            title: "Sentry trace",
            surface: "thread.sidePanel",
          },
        ],
        settings: [
          {
            id: "sentry.dsn",
            title: "Sentry DSN",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
              placeholder: "https://public@example.ingest.sentry.io/1",
            },
          },
        ],
        settingsPanels: [
          {
            id: "sentry.settings",
            title: "Sentry",
            description: "Configure telemetry destinations.",
            settingIds: ["sentry.dsn"],
          },
        ],
        hooks: ["session.started", "turn.started", "turn.settled", "runtime.error"],
      },
      capabilities: [
        {
          kind: "events.read",
          eventTypes: ["session.started", "turn.started", "turn.settled", "runtime.error"],
        },
        {
          kind: "secrets.read",
          names: ["SENTRY_DSN"],
        },
        {
          kind: "network.connect",
          hosts: ["sentry.io"],
        },
        {
          kind: "ui.embed",
          surfaces: ["thread.sidePanel"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-sentry-plugin.git",
      commit: "989908d3addb4411efaeae026910a970916adba9",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.terminal-settings",
      displayName: "Terminal appearance",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["t3-terminal-settings-plugin"],
        restart: "never",
      },
      contributes: {
        settings: [
          {
            id: "terminal.font-family",
            title: "Terminal font",
            description: "A monospace font family used by terminal surfaces.",
            scope: "client",
            storage: {
              kind: "client",
              key: "fontFamilyTerminal",
            },
            field: {
              kind: "text",
              default: "",
              placeholder: "SF Mono, Menlo, monospace",
            },
          },
          {
            id: "terminal.font-size",
            title: "Terminal font size",
            description: "Terminal cell size in CSS pixels.",
            scope: "client",
            storage: {
              kind: "client",
              key: "fontSizeTerminal",
            },
            field: {
              kind: "number",
              default: 12,
              min: 8,
              max: 20,
              step: 1,
            },
          },
        ],
        settingsPanels: [
          {
            id: "terminal.appearance",
            title: "Terminal appearance",
            description: "Customize the terminal independently from code blocks and diffs.",
            settingIds: ["terminal.font-family", "terminal.font-size"],
          },
        ],
      },
      capabilities: [],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-terminal-settings-plugin.git",
      commit: "55de24b8d21ce91d04db828ac222fc00ed2003b5",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.veritas",
      displayName: "Veritas verification cockpit",
      version: "0.2.0",
      runtime: {
        kind: "managed-app",
        command: ["veritas-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        navigation: [
          {
            id: "veritas.overview",
            title: "Overview",
            path: "/",
          },
          {
            id: "veritas.runs",
            title: "Runs",
            path: "/runs",
          },
          {
            id: "veritas.suites",
            title: "Suites",
            path: "/suites",
          },
          {
            id: "veritas.targets",
            title: "Targets",
            path: "/targets",
          },
          {
            id: "veritas.evidence",
            title: "Evidence",
            path: "/evidence",
          },
          {
            id: "veritas.failures",
            title: "Failures",
            path: "/failures",
          },
          {
            id: "veritas.provenance",
            title: "Provenance",
            path: "/provenance",
          },
        ],
        commands: [
          {
            id: "veritas.refresh",
            title: "Refresh verification status",
          },
          {
            id: "veritas.open-run",
            title: "Open verification run",
          },
          {
            id: "veritas.trigger-run",
            title: "Start verification run",
          },
        ],
        panels: [
          {
            id: "veritas.project-summary",
            title: "Verification summary",
            surface: "project",
          },
          {
            id: "veritas.thread-run",
            title: "Thread verification",
            surface: "thread.sidePanel",
          },
        ],
        workflows: [
          {
            id: "veritas.evidence-review",
            title: "Evidence review",
            surface: "thread.main",
          },
        ],
        settings: [
          {
            id: "veritas.endpoint",
            title: "Veritas endpoint",
            scope: "server",
            field: {
              kind: "text",
              default: "https://veritas.forgegraf.com",
            },
          },
          {
            id: "veritas.token",
            title: "Veritas token",
            scope: "server",
            field: {
              kind: "text",
              secret: true,
            },
          },
          {
            id: "veritas.project",
            title: "Default verification project",
            scope: "project",
            field: {
              kind: "text",
              placeholder: "project id",
            },
          },
          {
            id: "veritas.polling-seconds",
            title: "Refresh interval",
            scope: "server",
            field: {
              kind: "number",
              default: 60,
              min: 15,
              max: 3600,
              step: 15,
            },
          },
          {
            id: "veritas.auto-link",
            title: "Automatically link runs to threads",
            scope: "server",
            field: {
              kind: "boolean",
              default: true,
            },
          },
        ],
        settingsPanels: [
          {
            id: "veritas.connection",
            title: "Veritas",
            description: "Configure verification projects, targets, polling, and thread linking.",
            settingIds: [
              "veritas.endpoint",
              "veritas.token",
              "veritas.project",
              "veritas.polling-seconds",
              "veritas.auto-link",
            ],
          },
        ],
        hooks: ["turn.settled", "thread.completed", "runtime.error"],
      },
      capabilities: [
        {
          kind: "secrets.read",
          names: ["VERITAS_TOKEN"],
        },
        {
          kind: "network.connect",
          hosts: ["veritas.forgegraf.com"],
        },
        {
          kind: "filesystem.read",
          roots: ["project.root"],
        },
        {
          kind: "ui.embed",
          surfaces: ["project", "thread.sidePanel", "thread.main"],
        },
        {
          kind: "threads.read",
          projectIds: [],
        },
        {
          kind: "events.read",
          eventTypes: ["turn.settled", "thread.completed", "runtime.error"],
          projectIds: [],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-veritas-plugin.git",
      commit: "c880fe1c51d36dffe33160be6eca8770bf4f0cc4",
    },
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "com.t3code.voicebud",
      displayName: "VoiceBud composer bridge",
      version: "0.1.0",
      runtime: {
        kind: "managed-app",
        command: ["voicebud-t3-plugin"],
        restart: "on-failure",
      },
      contributes: {
        commands: [
          {
            id: "voicebud.bind",
            title: "Bind recording to composer",
          },
        ],
        hooks: ["thread.created"],
      },
      capabilities: [
        {
          kind: "threads.read",
        },
        {
          kind: "events.read",
          eventTypes: ["thread.created"],
        },
      ],
    },
    source: {
      kind: "git",
      url: "https://github.com/gmackie/t3code-voicebud-plugin.git",
      commit: "6a81e2776473b687704a809788a55ba0b5d0bb36",
    },
  },
] as const;
