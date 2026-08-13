import * as Schema from "effect/Schema";

export const PluginRepository = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("git"),
    url: Schema.String,
    ref: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("curated"),
    url: Schema.String,
    publicKey: Schema.optional(Schema.String),
  }),
]);
export type PluginRepository = typeof PluginRepository.Type;

export const PluginPackageSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("git"), url: Schema.String, commit: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("catalog"),
    repositoryId: Schema.optional(Schema.String),
    id: Schema.String,
  }),
]);
export type PluginPackageSource = typeof PluginPackageSource.Type;

export const PluginCatalogEntry = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  repository: PluginRepository,
  packagePath: Schema.optional(Schema.String),
  verified: Schema.Boolean,
});
export type PluginCatalogEntry = typeof PluginCatalogEntry.Type;
