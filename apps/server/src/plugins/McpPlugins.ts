import {
  McpPluginManifest,
  type McpPluginId,
  type McpPluginPanel,
  type McpPluginPanelId,
  type McpServerConfig,
  type McpServerTransport,
  type McpServerVariable,
  type ProjectId,
  type ResolvedMcpServer,
  type ServerSettingsError,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { toSafeThreadAttachmentSegment } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as McpClientPool from "../mcp/McpClientPool.ts";
import * as ServerSettings from "../serverSettings.ts";

export const McpPluginRecord = Schema.Struct({
  manifest: McpPluginManifest,
  /** Where the plugin's files live; `${pluginRoot}` resolves to it. */
  directory: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
});
export type McpPluginRecord = typeof McpPluginRecord.Type;

const McpPluginRecords = Schema.Array(McpPluginRecord);
const decodeRecords = Schema.decodeUnknownEffect(Schema.fromJsonString(McpPluginRecords));
const encodeRecords = Schema.encodeEffect(Schema.fromJsonString(McpPluginRecords));

export class McpPluginNotFoundError extends Schema.TaggedError<McpPluginNotFoundError>()(
  "McpPluginNotFoundError",
  { pluginId: Schema.String },
) {
  override get message(): string {
    return `Plugin "${this.pluginId}" isn't installed.`;
  }
}

export class McpPluginServerConflictError extends Schema.TaggedError<McpPluginServerConflictError>()(
  "McpPluginServerConflictError",
  { pluginId: Schema.String, server: Schema.String },
) {
  override get message(): string {
    return `Settings → Tools already has a server named "${this.server}". Rename or remove it to install this plugin.`;
  }
}

export class McpPluginStoreError extends Schema.TaggedError<McpPluginStoreError>()(
  "McpPluginStoreError",
  { operation: Schema.Literals(["read", "write"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to ${this.operation} the installed plugin list.`;
  }
}

/** The panel's plugin is missing or disabled, or its server is switched off for the project. */
export class McpPluginPanelUnavailableError extends Schema.TaggedError<McpPluginPanelUnavailableError>()(
  "McpPluginPanelUnavailableError",
  { pluginId: Schema.String, panelId: Schema.String },
) {
  override get message(): string {
    return `Panel "${this.panelId}" of plugin "${this.pluginId}" isn't available.`;
  }
}

export interface McpPluginPanelTarget {
  readonly record: McpPluginRecord;
  readonly panel: McpPluginPanel;
  /** The plugin's Tools entry with the project's overrides and secrets applied. */
  readonly server: ResolvedMcpServer;
}

/**
 * Installed v2 plugins. Each plugin's MCP server is a plugin-owned Settings →
 * Tools entry, so agents, secrets and project overrides work as for any
 * server; this service keeps the manifests and the enabled state beside it.
 */
export class McpPlugins extends Context.Service<
  McpPlugins,
  {
    readonly list: Effect.Effect<ReadonlyArray<McpPluginRecord>, McpPluginStoreError>;
    /** Installs or upgrades. Values fill the manifest's variables; omitted ones keep what's stored. */
    readonly install: (input: {
      readonly manifest: McpPluginManifest;
      readonly directory?: string;
      readonly variables?: Readonly<Record<string, string>>;
    }) => Effect.Effect<
      McpPluginRecord,
      McpPluginServerConflictError | McpPluginStoreError | ServerSettingsError
    >;
    readonly uninstall: (
      pluginId: McpPluginId,
    ) => Effect.Effect<void, McpPluginNotFoundError | McpPluginStoreError | ServerSettingsError>;
    /** Disabling also switches the Tools entry off; enabling switches it back on. */
    readonly setEnabled: (
      pluginId: McpPluginId,
      enabled: boolean,
    ) => Effect.Effect<
      McpPluginRecord,
      McpPluginNotFoundError | McpPluginStoreError | ServerSettingsError
    >;
    readonly resolvePanel: (input: {
      readonly pluginId: McpPluginId;
      readonly panelId: McpPluginPanelId;
      readonly projectId: ProjectId;
    }) => Effect.Effect<
      McpPluginPanelTarget,
      McpPluginPanelUnavailableError | McpPluginStoreError | ServerSettingsError
    >;
  }
>()("t3/plugins/McpPlugins") {}

/** Plugin panel views are stored as attachments under this segment, so uninstall can remove them. */
export const pluginAttachmentSegment = (pluginId: string) =>
  toSafeThreadAttachmentSegment(`plugin-${pluginId}`);

const PLUGIN_ROOT = "${pluginRoot}";

const withPluginRoot = (value: string, directory: string | undefined) =>
  directory === undefined ? value : value.replaceAll(PLUGIN_ROOT, directory);

const fillVariables = (
  variables: ReadonlyArray<McpServerVariable>,
  values: Readonly<Record<string, string>>,
): ReadonlyArray<McpServerVariable> =>
  variables.map((variable) => {
    const value = values[variable.name];
    return value === undefined ? variable : { ...variable, value };
  });

const storedValues = (transport: McpServerTransport | undefined): Record<string, string> => {
  const variables =
    transport === undefined ? [] : transport.type === "stdio" ? transport.env : transport.headers;
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.value]));
};

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir, attachmentsDir } = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const pool = yield* McpClientPool.McpClientPool;
  const recordsPath = path.join(stateDir, "mcp-plugins.json");
  const lock = yield* Semaphore.make(1);

  const readRecords = fileSystem.readFileString(recordsPath).pipe(
    Effect.flatMap(decodeRecords),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
    }),
    Effect.mapError((cause) => new McpPluginStoreError({ operation: "read", cause })),
  );

  const writeRecords = (records: ReadonlyArray<McpPluginRecord>) =>
    encodeRecords(records).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath: recordsPath, contents: `${contents}\n` }),
      ),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new McpPluginStoreError({ operation: "write", cause })),
    );

  const findRecord = Effect.fnUntraced(function* (pluginId: McpPluginId) {
    const records = yield* readRecords;
    const record = records.find((candidate) => candidate.manifest.id === pluginId);
    if (record === undefined) return yield* new McpPluginNotFoundError({ pluginId });
    return { records, record };
  });

  const toolsEntry = (
    record: McpPluginRecord,
    values: Readonly<Record<string, string>>,
  ): McpServerConfig => {
    const { manifest, directory } = record;
    const transport = manifest.mcpServer.transport;
    return {
      enabled: record.enabled,
      plugin: { id: manifest.id, displayName: manifest.displayName },
      transport:
        transport.type === "stdio"
          ? {
              ...transport,
              command: withPluginRoot(transport.command, directory),
              args: transport.args.map((arg) => withPluginRoot(arg, directory)),
              env: fillVariables(transport.env, values),
            }
          : { ...transport, headers: fillVariables(transport.headers, values) },
    };
  };

  const removeViews = Effect.fn("McpPlugins.removeViews")(
    function* (pluginId: string) {
      const segment = pluginAttachmentSegment(pluginId);
      if (segment === null) return;
      const names = yield* fileSystem.readDirectory(attachmentsDir);
      yield* Effect.forEach(
        names.filter((name) => name.startsWith(`${segment}-`)),
        (name) => fileSystem.remove(path.join(attachmentsDir, name), { force: true }),
        { discard: true },
      );
    },
    Effect.ignoreCause({ log: true }),
  );

  const install: McpPlugins["Service"]["install"] = Effect.fn("McpPlugins.install")(
    function* (input) {
      const { manifest } = input;
      const name = manifest.mcpServer.name;
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const records = yield* readRecords;
          const previous = records.find((record) => record.manifest.id === manifest.id);
          const record: McpPluginRecord = {
            manifest,
            enabled: previous?.enabled ?? true,
            ...(input.directory === undefined ? {} : { directory: input.directory }),
          };
          const current = yield* settings.getSettings;
          const values = {
            ...storedValues(current.mcpServers[name]?.transport),
            ...input.variables,
          };
          const renamed =
            previous !== undefined && previous.manifest.mcpServer.name !== name
              ? { [previous.manifest.mcpServer.name]: null }
              : {};
          // Checked under the settings write lock, so a user's entry can't appear in between.
          yield* settings.updateSettings(
            { mcpServers: { ...renamed, [name]: toolsEntry(record, values) } },
            (latest) => {
              const existing = latest.mcpServers[name];
              return existing !== undefined && existing.plugin?.id !== manifest.id
                ? Effect.fail(
                    new McpPluginServerConflictError({ pluginId: manifest.id, server: name }),
                  )
                : Effect.void;
            },
          );
          yield* writeRecords([
            ...records.filter((candidate) => candidate.manifest.id !== manifest.id),
            record,
          ]);
          if (previous !== undefined) {
            yield* pool.closeServer(previous.manifest.mcpServer.name);
          }
          return record;
        }),
      );
    },
  );

  const uninstall: McpPlugins["Service"]["uninstall"] = Effect.fn("McpPlugins.uninstall")(
    function* (pluginId) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const { records, record } = yield* findRecord(pluginId);
          const name = record.manifest.mcpServer.name;
          const current = yield* settings.getSettings;
          if (current.mcpServers[name]?.plugin?.id === pluginId) {
            yield* settings.updateSettings({ mcpServers: { [name]: null } });
          }
          yield* writeRecords(records.filter((candidate) => candidate !== record));
          yield* pool.closeServer(name);
          yield* removeViews(pluginId);
        }),
      );
    },
  );

  const setEnabled: McpPlugins["Service"]["setEnabled"] = Effect.fn("McpPlugins.setEnabled")(
    function* (pluginId, enabled) {
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const { records, record } = yield* findRecord(pluginId);
          const next: McpPluginRecord = { ...record, enabled };
          const name = record.manifest.mcpServer.name;
          const current = yield* settings.getSettings;
          const entry = current.mcpServers[name];
          if (entry?.plugin?.id === pluginId) {
            yield* settings.updateSettings({ mcpServers: { [name]: { ...entry, enabled } } });
          }
          yield* writeRecords(
            records.map((candidate) => (candidate === record ? next : candidate)),
          );
          if (!enabled) yield* pool.closeServer(name);
          return next;
        }),
      );
    },
  );

  const resolvePanel: McpPlugins["Service"]["resolvePanel"] = Effect.fn("McpPlugins.resolvePanel")(
    function* (input) {
      const unavailable = new McpPluginPanelUnavailableError({
        pluginId: input.pluginId,
        panelId: input.panelId,
      });
      const records = yield* readRecords;
      const record = records.find((candidate) => candidate.manifest.id === input.pluginId);
      const panel = record?.manifest.contributes.panels.find(
        (candidate) => candidate.id === input.panelId,
      );
      if (record === undefined || panel === undefined || !record.enabled) {
        return yield* unavailable;
      }
      const name = record.manifest.mcpServer.name;
      const effective = resolveProjectSettings(
        yield* settings.getSettings,
        input.projectId,
      ).settings;
      const entry = effective.mcpServers[name];
      if (entry === undefined || !entry.enabled || entry.plugin?.id !== input.pluginId) {
        return yield* unavailable;
      }
      return { record, panel, server: { name, transport: entry.transport } };
    },
  );

  return McpPlugins.of({ list: readRecords, install, uninstall, setEnabled, resolvePanel });
});

export const layer = Layer.effect(McpPlugins, make);
