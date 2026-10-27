import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { ValueType as ValueTypeSchema } from "@t3tools/systems-model/documents";

import { combine, DIMENSIONLESS, unitOf, type Unit, type UnitTable } from "./units.ts";

/**
 * Compiler-side block semantics keyed by versioned type id (decision 2). The locked
 * catalog only names ports; per-port units, value types, domains and which blocks
 * break instantaneous loops live here, and the RFC wins where the catalog disagrees.
 */

export type ValueType = typeof ValueTypeSchema.Type;

/** `constant` is timing-polymorphic; every other crossing needs an explicit adapter. */
export type Domain = "constant" | "continuous" | `clocked:${string}` | `event:${string}`;

export interface Port {
  readonly unit: Unit;
  readonly valueType: ValueType;
  readonly domain: Domain;
}

/** What an input accepts; an absent field accepts whatever drives it. */
export interface Expectation {
  readonly valueType?: "bool" | "numeric";
  readonly unit?: Unit;
  readonly domain?: Domain;
}

/** Step kind inside a clock partition (RFC-001 §6.2 Phase D). */
export type ClockAction = "sample" | "evaluate" | "chart" | "stage";

export type Parameters = Readonly<Record<string, unknown>>;

interface Context {
  readonly parameters: Parameters;
  readonly units: UnitTable;
}

export interface PortRules {
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
  /** Expectation for `port`, given the ports already resolved for earlier inputs. */
  readonly expect: (
    context: Context,
    port: string,
    inputs: Readonly<Record<string, Port | undefined>>,
  ) => Expectation;
  /** `domain` is the join of the input domains, for blocks that inherit it. */
  readonly output: (
    context: Context,
    inputs: Readonly<Record<string, Port | undefined>>,
    domain: Domain,
  ) => Port;
}

export interface BlockSemantics {
  readonly decode: (input: unknown) => Result.Result<Parameters, Schema.SchemaError>;
  /** Semantic defaults inserted before digesting (RFC-001 §3.2). */
  readonly defaults: Parameters;
  /** Outputs read stored state, so edges out of the block carry no same-time dependency. */
  readonly stateful: boolean;
  readonly inheritsDomain: boolean;
  /** Clock partition the block executes in; `undefined` places it by its output domain. */
  readonly clock: (parameters: Parameters) => string | undefined;
  readonly action: ClockAction;
  /** Ports, or `undefined` when the referenced chart's interface defines them. */
  readonly ports: PortRules | undefined;
}

const STRICT = { onExcessProperty: "error", errors: "all" } as const;
const Scalar = Schema.Union([Schema.Number, Schema.Boolean]);
const optional = Schema.optionalKey;

const decoder = (schema: Schema.Decoder<Parameters>) => {
  const decode = Schema.decodeUnknownResult(schema);
  return (input: unknown) => decode(input, STRICT) as Result.Result<Parameters, Schema.SchemaError>;
};

const text = (parameters: Parameters, name: string) => {
  const value = parameters[name];
  return typeof value === "string" ? value : undefined;
};
const unitParameter = ({ parameters, units }: Context, name: string) => {
  const symbol = text(parameters, name);
  return symbol === undefined ? undefined : unitOf(units, symbol);
};
const clocked = (clock: string | undefined): Domain => `clocked:${clock ?? ""}`;
const float = (unit: Unit, domain: Domain): Port => ({ unit, valueType: "float64", domain });
const dimensionless = (context: Context) => unitOf(context.units, DIMENSIONLESS);
const optionalUnit = (unit: Unit | undefined) => (unit === undefined ? {} : { unit });

/** One-input block whose value passes through a time-domain adapter or register. */
const adapter = (
  rules: {
    readonly schema: Schema.Decoder<Parameters>;
    readonly defaults?: Parameters;
    readonly clock: (parameters: Parameters) => string | undefined;
    readonly action: ClockAction;
    readonly input: (parameters: Parameters) => Domain;
    readonly output: (parameters: Parameters) => Domain;
  },
  stateful: boolean,
): BlockSemantics => ({
  decode: decoder(rules.schema),
  defaults: rules.defaults ?? {},
  stateful,
  inheritsDomain: false,
  clock: rules.clock,
  action: rules.action,
  ports: {
    inputs: ["value"],
    outputs: ["value"],
    expect: (context) => ({
      ...optionalUnit(unitParameter(context, "unit")),
      domain: rules.input(context.parameters),
    }),
    output: (context, inputs) => ({
      unit: unitParameter(context, "unit") ?? inputs.value?.unit ?? dimensionless(context),
      valueType: inputs.value?.valueType ?? "float64",
      domain: rules.output(context.parameters),
    }),
  },
});

const pure = (
  schema: Schema.Decoder<Parameters>,
  defaults: Parameters,
  ports: PortRules,
): BlockSemantics => ({
  decode: decoder(schema),
  defaults,
  stateful: false,
  inheritsDomain: true,
  clock: () => undefined,
  action: "evaluate",
  ports,
});

const clockOf = (parameters: Parameters) => text(parameters, "clock");

export const BLOCK_SEMANTICS: Readonly<Record<string, BlockSemantics>> = {
  "std.constant@1": pure(
    Schema.Struct({ value: Scalar, unit: optional(Schema.String) }),
    { unit: "1" },
    {
      inputs: [],
      outputs: ["value"],
      expect: () => ({}),
      output: (context) => ({
        unit: unitParameter(context, "unit") ?? dimensionless(context),
        valueType: typeof context.parameters.value === "boolean" ? "bool" : "float64",
        domain: "constant",
      }),
    },
  ),
  "std.sum2@1": pure(
    Schema.Struct({ unit: optional(Schema.String) }),
    {},
    {
      inputs: ["a", "b"],
      outputs: ["value"],
      expect: (context, port, inputs) => ({
        valueType: "numeric",
        ...optionalUnit(
          unitParameter(context, "unit") ?? (port === "b" ? inputs.a?.unit : undefined),
        ),
      }),
      output: (context, inputs, domain) =>
        float(unitParameter(context, "unit") ?? inputs.a?.unit ?? dimensionless(context), domain),
    },
  ),
  "std.gain@1": pure(
    Schema.Struct({ gain: Schema.Number, gainUnit: optional(Schema.String) }),
    { gainUnit: "1" },
    {
      inputs: ["value"],
      outputs: ["value"],
      expect: () => ({ valueType: "numeric" }),
      output: (context, inputs, domain) => {
        const gain = unitParameter(context, "gainUnit") ?? dimensionless(context);
        return float(
          inputs.value === undefined ? gain : combine(context.units, inputs.value.unit, gain, 1),
          domain,
        );
      },
    },
  ),
  "std.boolean_to_scalar@1": pure(
    Schema.Struct({}),
    {},
    {
      inputs: ["value"],
      outputs: ["value"],
      expect: () => ({ valueType: "bool" }),
      output: (context, _inputs, domain) => float(dimensionless(context), domain),
    },
  ),
  "std.unit_convert@1": pure(
    Schema.Struct({ fromUnit: Schema.String, toUnit: Schema.String }),
    {},
    {
      inputs: ["value"],
      outputs: ["value"],
      expect: (context) => ({
        valueType: "numeric",
        ...optionalUnit(unitParameter(context, "fromUnit")),
      }),
      output: (context, _inputs, domain) => float(unitParameter(context, "toUnit")!, domain),
    },
  ),
  "std.integrator@1": {
    decode: decoder(
      Schema.Struct({ initial: Schema.Number, unit: Schema.String, derivativeUnit: Schema.String }),
    ),
    defaults: {},
    stateful: true,
    inheritsDomain: false,
    clock: () => undefined,
    action: "evaluate",
    ports: {
      inputs: ["derivative"],
      outputs: ["value"],
      expect: (context) => ({
        valueType: "numeric",
        ...optionalUnit(unitParameter(context, "derivativeUnit")),
        domain: "continuous",
      }),
      output: (context) => float(unitParameter(context, "unit")!, "continuous"),
    },
  },
  // Captures its continuous input at t⁻ on its clock tick; feedthrough only within that tick.
  "std.sample@1": adapter(
    {
      schema: Schema.Struct({ clock: Schema.String, unit: optional(Schema.String) }),
      clock: clockOf,
      action: "sample",
      input: () => "continuous",
      output: (parameters) => clocked(clockOf(parameters)),
    },
    false,
  ),
  // Continuous output is the committed clocked value, so it breaks instantaneous loops.
  "std.hold@1": adapter(
    {
      schema: Schema.Struct({
        clock: Schema.String,
        initial: Scalar,
        unit: optional(Schema.String),
      }),
      clock: clockOf,
      action: "stage",
      input: (parameters) => clocked(clockOf(parameters)),
      output: () => "continuous",
    },
    true,
  ),
  "std.delay@1": adapter(
    {
      schema: Schema.Struct({
        clock: Schema.String,
        initial: Scalar,
        unit: optional(Schema.String),
      }),
      clock: clockOf,
      action: "stage",
      input: (parameters) => clocked(clockOf(parameters)),
      output: (parameters) => clocked(clockOf(parameters)),
    },
    true,
  ),
  // Reads the source clock's previously committed value at each target tick (decision 5).
  "std.rate_transition@1": adapter(
    {
      schema: Schema.Struct({
        sourceClock: Schema.String,
        targetClock: Schema.String,
        policy: Schema.Literal("previous_committed"),
        initial: Scalar,
        unit: optional(Schema.String),
      }),
      defaults: { policy: "previous_committed" },
      clock: (parameters) => text(parameters, "targetClock"),
      action: "sample",
      input: (parameters) => clocked(text(parameters, "sourceClock")),
      output: (parameters) => clocked(text(parameters, "targetClock")),
    },
    true,
  ),
  "std.counter@1": {
    decode: decoder(
      Schema.Struct({
        clock: Schema.String,
        initial: Schema.Number,
        increment: Schema.Number,
        unit: optional(Schema.String),
      }),
    ),
    defaults: { initial: 0, increment: 1, unit: "1" },
    stateful: true,
    inheritsDomain: false,
    clock: clockOf,
    action: "stage",
    ports: {
      inputs: [],
      outputs: ["value"],
      expect: () => ({}),
      output: (context) => ({
        unit: unitParameter(context, "unit") ?? dimensionless(context),
        valueType: "int32",
        domain: clocked(clockOf(context.parameters)),
      }),
    },
  },
  // Runs on its clock after its sampled inputs; outputs are visible downstream in the same tick.
  "std.statechart@1": {
    decode: decoder(Schema.Struct({ chart: Schema.String, clock: optional(Schema.String) })),
    defaults: {},
    stateful: false,
    inheritsDomain: false,
    clock: clockOf,
    action: "chart",
    ports: undefined,
  },
};
