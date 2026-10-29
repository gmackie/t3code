import * as Schema from "effect/Schema";

const ResourceScope = {
  projectIds: Schema.optional(Schema.Array(Schema.String)),
  threadIds: Schema.optional(Schema.Array(Schema.String)),
};

export const PluginCapabilityRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("events.read"),
    eventTypes: Schema.Array(Schema.String),
    ...ResourceScope,
  }),
  Schema.Struct({ kind: Schema.Literal("threads.read"), ...ResourceScope }),
  Schema.Struct({
    kind: Schema.Literal("threads.dispatch"),
    projectIds: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literals(["filesystem.read", "filesystem.write"]),
    roots: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("secrets.read"), names: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("network.connect"), hosts: Schema.Array(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal("ui.embed"),
    surfaces: Schema.Array(
      Schema.Literals(["settings", "project", "thread.sidePanel", "thread.main"]),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("provider.control"),
    providerInstanceIds: Schema.optional(Schema.Array(Schema.String)),
  }),
  // Lets the plugin read composer drafts before they are sent (see the
  // `composer.beforeSubmit` hook).
  Schema.Struct({ kind: Schema.Literal("composer.review") }),
]);
export type PluginCapabilityRequest = typeof PluginCapabilityRequest.Type;

export const PluginCapabilityKind = Schema.Literals([
  "events.read",
  "threads.read",
  "threads.dispatch",
  "filesystem.read",
  "filesystem.write",
  "secrets.read",
  "network.connect",
  "ui.embed",
  "provider.control",
  "composer.review",
]);
export type PluginCapabilityKind = typeof PluginCapabilityKind.Type;
