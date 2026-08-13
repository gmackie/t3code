// @effect-diagnostics nodeBuiltinImport:off - plugin registry persistence is a server-side Node boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

import { PluginCapabilityRequest, PluginManifest, PluginPackageSource } from "@t3tools/contracts";

const PersistedPluginRecord = Schema.Struct({
  manifest: PluginManifest,
  source: PluginPackageSource,
  grants: Schema.Array(PluginCapabilityRequest),
  directory: Schema.optional(Schema.String),
});
const PersistedPluginState = Schema.Array(PersistedPluginRecord);
const decodePersistedPluginState = Schema.decodeUnknownSync(PersistedPluginState);

export type PersistedPluginRecord = typeof PersistedPluginRecord.Type;

export class PluginStateStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  load(): readonly PersistedPluginRecord[] {
    try {
      const contents = NodeFS.readFileSync(this.#path, "utf8");
      return decodePersistedPluginState(JSON.parse(contents));
    } catch {
      return [];
    }
  }

  save(records: readonly PersistedPluginRecord[]): void {
    const directory = NodePath.dirname(this.#path);
    NodeFS.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.#path}.tmp-${process.pid}`;
    NodeFS.writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    NodeFS.renameSync(temporaryPath, this.#path);
  }
}
