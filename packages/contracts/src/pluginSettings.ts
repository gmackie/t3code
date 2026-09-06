import * as Schema from "effect/Schema";

export const PluginSettingOption = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
});

export const PluginSettingField = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    default: Schema.optional(Schema.String),
    placeholder: Schema.optional(Schema.String),
    secret: Schema.optional(Schema.Boolean),
    minLength: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    maxLength: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    pattern: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("number"),
    default: Schema.optional(Schema.Number),
    min: Schema.optional(Schema.Number),
    max: Schema.optional(Schema.Number),
    step: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("boolean"),
    default: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("select"),
    options: Schema.Array(PluginSettingOption),
    default: Schema.optional(Schema.String),
  }),
]);
export type PluginSettingField = typeof PluginSettingField.Type;

export const PluginSettingContribution = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  scope: Schema.Literals(["client", "server", "project"]),
  storage: Schema.optional(
    Schema.Struct({
      kind: Schema.Literal("client"),
      key: Schema.String,
    }),
  ),
  field: PluginSettingField,
});
export type PluginSettingContribution = typeof PluginSettingContribution.Type;

export function isPluginSettingSecret(contribution: PluginSettingContribution): boolean {
  return contribution.field.kind === "text" && contribution.field.secret === true;
}

export const PluginSettingValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export type PluginSettingValue = typeof PluginSettingValue.Type;
export const PluginSettingValueMap = Schema.Record(Schema.String, PluginSettingValue);
export type PluginSettingValueMap = typeof PluginSettingValueMap.Type;

export const PluginSettingsGetInput = Schema.Struct({
  pluginId: Schema.String,
  projectId: Schema.optional(Schema.String),
});
export type PluginSettingsGetInput = typeof PluginSettingsGetInput.Type;

export const PluginSettingsUpdateInput = Schema.Struct({
  pluginId: Schema.String,
  projectId: Schema.optional(Schema.String),
  values: PluginSettingValueMap,
});
export type PluginSettingsUpdateInput = typeof PluginSettingsUpdateInput.Type;

export const PluginSettingsResetInput = PluginSettingsGetInput;
export type PluginSettingsResetInput = typeof PluginSettingsResetInput.Type;

export const PluginSettingsSnapshot = Schema.Struct({
  pluginId: Schema.String,
  projectId: Schema.optional(Schema.String),
  values: PluginSettingValueMap,
  redacted: Schema.Array(Schema.String),
});
export type PluginSettingsSnapshot = typeof PluginSettingsSnapshot.Type;

export function defaultPluginSettings(
  contributions: readonly PluginSettingContribution[],
): PluginSettingValueMap {
  return Object.fromEntries(
    contributions.map((contribution) => [contribution.id, defaultValue(contribution.field)]),
  );
}

export function validatePluginSettings(
  contributions: readonly PluginSettingContribution[],
  values: PluginSettingValueMap,
): PluginSettingValueMap {
  const byId = new Map(contributions.map((contribution) => [contribution.id, contribution]));
  for (const [id, value] of Object.entries(values)) {
    const contribution = byId.get(id);
    if (!contribution) throw new Error(`unknown setting: ${id}`);
    validateValue(contribution, value);
  }
  return { ...defaultPluginSettings(contributions), ...values };
}

function defaultValue(field: PluginSettingField): PluginSettingValue {
  if (field.kind === "text") return field.default ?? "";
  if (field.kind === "number") return field.default ?? 0;
  if (field.kind === "boolean") return field.default ?? false;
  return field.default ?? field.options[0]?.value ?? "";
}

function validateValue(contribution: PluginSettingContribution, value: PluginSettingValue): void {
  const field = contribution.field;
  if (field.kind === "text") {
    if (typeof value !== "string") throw new Error(`expected string for ${contribution.id}`);
    if (field.minLength !== undefined && value.length < field.minLength) {
      throw new Error(`setting ${contribution.id} is too short`);
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      throw new Error(`setting ${contribution.id} is too long`);
    }
    if (field.pattern !== undefined && !new RegExp(field.pattern, "u").test(value)) {
      throw new Error(`setting ${contribution.id} has an invalid format`);
    }
    return;
  }
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`expected number for ${contribution.id}`);
    }
    if (field.min !== undefined && value < field.min)
      throw new Error(`setting ${contribution.id} is below minimum`);
    if (field.max !== undefined && value > field.max)
      throw new Error(`setting ${contribution.id} is above maximum`);
    return;
  }
  if (field.kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`expected boolean for ${contribution.id}`);
    return;
  }
  if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
    throw new Error(`invalid option for ${contribution.id}`);
  }
}
