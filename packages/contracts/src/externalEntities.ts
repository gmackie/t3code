import * as Schema from "effect/Schema";

export const ExternalEntityRef = Schema.Struct({
  providerId: Schema.String,
  entityType: Schema.String,
  entityId: Schema.String,
  key: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export type ExternalEntityRef = typeof ExternalEntityRef.Type;

export const PluginEntityLink = Schema.Struct({
  source: ExternalEntityRef,
  target: ExternalEntityRef,
  relation: Schema.Literals([
    "implements",
    "tracks",
    "dispatches",
    "runs",
    "opens-thread",
    "blocks",
  ]),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type PluginEntityLink = typeof PluginEntityLink.Type;
