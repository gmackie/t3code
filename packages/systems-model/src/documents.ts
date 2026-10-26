import * as Schema from "effect/Schema";

import { DiagnosticCode } from "./diagnostics.ts";
import { RationalTime } from "./rational.ts";

/**
 * Authoring documents of RFC-001 v0.1. These mirror the draft JSON Schemas shipped in
 * `fixtures/conformance-v0.1/schemas`; decode with `onExcessProperty: "error"` (see
 * `validate.ts`) so unknown executable fields fail instead of being ignored.
 */

/** Stable model-local key. Names are display labels; references always use ids. */
export const ElementId = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$/));
export type ElementId = typeof ElementId.Type;

/** Workspace-relative path; normalization is checked by the validator. */
const WorkspacePath = Schema.String.check(Schema.isMinLength(1));
const DecimalInteger = Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]*)$/));
const ScalarLiteral = Schema.Union([Schema.Number, Schema.Boolean, Schema.String]);

const SchemaVersion = Schema.Literal("0.1.0");
const SemanticsVersion = Schema.Literal("0.1");

// System graph

export const ClockSpec = Schema.Struct({
  id: ElementId,
  kind: Schema.Literal("periodic"),
  period: RationalTime,
  offset: RationalTime,
  /** Lower number executes first at a tied physical time. */
  priority: Schema.Int,
});
export type ClockSpec = typeof ClockSpec.Type;

export const NodeInstance = Schema.Struct({
  id: ElementId,
  /** Versioned block type, e.g. `std.integrator@1`, resolved through the library lock. */
  type: Schema.String.check(Schema.isMinLength(1)),
  parameters: Schema.Record(Schema.String, Schema.Unknown),
});
export type NodeInstance = typeof NodeInstance.Type;

export const PortRef = Schema.Struct({ node: ElementId, port: ElementId });
export type PortRef = typeof PortRef.Type;

export const SignalEdge = Schema.Struct({
  id: ElementId,
  kind: Schema.Literal("signal"),
  from: PortRef,
  to: PortRef,
});
export type SignalEdge = typeof SignalEdge.Type;

export const OutputProbe = Schema.Struct({ id: ElementId, source: PortRef });
export type OutputProbe = typeof OutputProbe.Type;

export const SystemDocument = Schema.Struct({
  format: Schema.Literal("sw.system"),
  schemaVersion: SchemaVersion,
  semanticsVersion: SemanticsVersion,
  id: ElementId,
  title: Schema.optionalKey(Schema.String),
  clocks: Schema.Array(ClockSpec),
  nodes: Schema.Array(NodeInstance),
  edges: Schema.Array(SignalEdge),
  outputs: Schema.optionalKey(Schema.Array(OutputProbe)),
});
export type SystemDocument = typeof SystemDocument.Type;

// Statechart

export type Expr =
  | { readonly op: "literal"; readonly value: number | boolean | string; readonly unit?: string }
  | { readonly op: "ref"; readonly path: string }
  | {
      readonly op:
        | "eq"
        | "ne"
        | "lt"
        | "le"
        | "gt"
        | "ge"
        | "add"
        | "sub"
        | "mul"
        | "div"
        | "and"
        | "or";
      readonly left: Expr;
      readonly right: Expr;
    }
  | { readonly op: "not"; readonly arg: Expr };

const ExprRef = Schema.suspend((): Schema.Codec<Expr> => Expr);

export const Expr: Schema.Codec<Expr> = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("literal"),
    value: ScalarLiteral,
    unit: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("ref"), path: Schema.String.check(Schema.isMinLength(1)) }),
  Schema.Struct({
    op: Schema.Literals([
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
      "add",
      "sub",
      "mul",
      "div",
      "and",
      "or",
    ]),
    left: ExprRef,
    right: ExprRef,
  }),
  Schema.Struct({ op: Schema.Literal("not"), arg: ExprRef }),
]);

export const Action = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("assign"),
    target: Schema.String.check(Schema.isMinLength(1)),
    value: Expr,
  }),
  Schema.Struct({ op: Schema.Literal("emit"), eventId: ElementId }),
]);
export type Action = typeof Action.Type;

export const Trigger = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["event", "clock"]), id: ElementId }),
  Schema.Struct({ kind: Schema.Literal("after"), duration: RationalTime }),
  Schema.Struct({ kind: Schema.Literal("always") }),
]);
export type Trigger = typeof Trigger.Type;

export const ValueType = Schema.Literals([
  "bool",
  "int32",
  "uint32",
  "float32",
  "float64",
  "string",
]);

const ChartVariable = Schema.Struct({
  id: ElementId,
  type: ValueType,
  unit: Schema.optionalKey(Schema.String),
  initial: Schema.optionalKey(ScalarLiteral),
  /** `continuous`, `constant`, `clocked:<clockId>` or `event:<eventType>`. */
  domain: Schema.optionalKey(Schema.String),
});

export const ChartState = Schema.Struct({
  id: ElementId,
  type: Schema.Literals(["atomic", "compound"]),
  parent: Schema.optionalKey(ElementId),
  initial: Schema.optionalKey(ElementId),
  entry: Schema.optionalKey(Schema.Array(Action)),
  exit: Schema.optionalKey(Schema.Array(Action)),
});
export type ChartState = typeof ChartState.Type;

export const ChartTransition = Schema.Struct({
  id: ElementId,
  source: ElementId,
  target: ElementId,
  kind: Schema.Literals(["external", "internal"]),
  trigger: Trigger,
  /** Smallest wins within one source state; depth wins across states. */
  priority: Schema.Int,
  guard: Schema.optionalKey(Expr),
  actions: Schema.optionalKey(Schema.Array(Action)),
});
export type ChartTransition = typeof ChartTransition.Type;

export const ChartDocument = Schema.Struct({
  format: Schema.Literal("sw.statechart"),
  schemaVersion: SchemaVersion,
  semanticsVersion: SemanticsVersion,
  id: ElementId,
  title: Schema.optionalKey(Schema.String),
  interface: Schema.Struct({
    inputs: Schema.Array(ChartVariable),
    outputs: Schema.Array(ChartVariable),
    events: Schema.Array(Schema.Struct({ id: ElementId })),
  }),
  root: ElementId,
  states: Schema.Array(ChartState),
  transitions: Schema.Array(ChartTransition),
});
export type ChartDocument = typeof ChartDocument.Type;

// Experiments and expected traces

const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0));

export const RunDocument = Schema.Struct({
  format: Schema.Literal("sw.run"),
  schemaVersion: SchemaVersion,
  id: ElementId,
  /** Exactly one of `modelRef` and `chartRef`. */
  modelRef: Schema.optionalKey(WorkspacePath),
  chartRef: Schema.optionalKey(WorkspacePath),
  start: RationalTime,
  stop: RationalTime,
  solver: Schema.Struct({
    method: Schema.Literals(["none", "rk4-fixed@1", "rk45-dopri5@1"]),
    fixedStep: Schema.optionalKey(RationalTime),
    absTol: Schema.optionalKey(PositiveNumber),
    relTol: Schema.optionalKey(PositiveNumber),
  }),
  inputs: Schema.Array(
    Schema.Struct({
      kind: Schema.Literal("event"),
      time: RationalTime,
      type: ElementId,
      priority: Schema.Int,
      sourceId: ElementId,
      ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  seed: DecimalInteger,
  probes: Schema.Array(ElementId),
});
export type RunDocument = typeof RunDocument.Type;

export const ExpectedTraceDocument = Schema.Struct({
  format: Schema.Literal("sw.expectedTrace"),
  schemaVersion: SchemaVersion,
  fixtureId: ElementId,
  runRef: WorkspacePath,
  numericAbsTolerance: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  observations: Schema.Array(
    Schema.Struct({
      time: RationalTime,
      activeState: Schema.optionalKey(ElementId),
      signals: Schema.Record(
        Schema.String,
        Schema.Struct({
          value: Schema.Union([Schema.Number, Schema.Boolean]),
          unit: Schema.String,
        }),
      ),
      firedTransitions: Schema.Array(ElementId),
    }),
  ),
  expectedTransitions: Schema.Array(
    Schema.Struct({
      time: RationalTime,
      transitionId: ElementId,
      exit: Schema.optionalKey(Schema.Array(ElementId)),
      enter: Schema.optionalKey(Schema.Array(ElementId)),
    }),
  ),
  notes: Schema.optionalKey(Schema.String),
});
export type ExpectedTraceDocument = typeof ExpectedTraceDocument.Type;

/** Canvas state. Excluded from the semantic digest: moving a block never changes behavior. */
export const LayoutDocument = Schema.Struct({
  format: Schema.Literal("sw.layout"),
  schemaVersion: SchemaVersion,
  modelId: ElementId,
  positions: Schema.Record(Schema.String, Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  viewport: Schema.Struct({ x: Schema.Number, y: Schema.Number, zoom: PositiveNumber }),
});
export type LayoutDocument = typeof LayoutDocument.Type;

// Libraries, locks and projects

/** SI base dimension exponents: mass, length, time, current, temperature, amount, luminosity. */
const Dimensions = Schema.Tuple([
  Schema.Int,
  Schema.Int,
  Schema.Int,
  Schema.Int,
  Schema.Int,
  Schema.Int,
  Schema.Int,
]);

export const BlockType = Schema.Struct({
  type: Schema.String.check(Schema.isMinLength(1)),
  stateKind: Schema.Literals(["pure", "clocked", "continuous", "event", "foreign"]),
  inputs: Schema.Array(ElementId),
  outputs: Schema.Array(ElementId),
  /** Any output depends on a same-time input; such blocks form algebraic loops. */
  feedthrough: Schema.Boolean,
});
export type BlockType = typeof BlockType.Type;

export const BlockCatalogDocument = Schema.Struct({
  format: Schema.Literal("sw.blockCatalog"),
  schemaVersion: SchemaVersion,
  semanticsVersion: SemanticsVersion,
  id: ElementId,
  version: Schema.String,
  units: Schema.Record(Schema.String, Schema.Struct({ dims: Dimensions, scale: Schema.String })),
  blockTypes: Schema.Array(BlockType),
});
export type BlockCatalogDocument = typeof BlockCatalogDocument.Type;

export const LockDocument = Schema.Struct({
  format: Schema.Literal("sw.lock"),
  schemaVersion: SchemaVersion,
  libraries: Schema.Array(
    Schema.Struct({
      name: ElementId,
      version: Schema.String,
      file: WorkspacePath,
      sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
    }),
  ),
});
export type LockDocument = typeof LockDocument.Type;

export const ProjectDocument = Schema.Struct({
  format: Schema.Literal("sw.project"),
  schemaVersion: SchemaVersion,
  name: Schema.String,
  lockRef: WorkspacePath,
  entrypoints: Schema.Array(WorkspacePath),
});
export type ProjectDocument = typeof ProjectDocument.Type;

export const ConformancePackDocument = Schema.Struct({
  format: Schema.Literal("sw.conformancePack"),
  version: Schema.String,
  semanticsVersion: SemanticsVersion,
  status: Schema.String,
  fixtures: Schema.Array(
    Schema.Struct({
      id: ElementId,
      source: WorkspacePath,
      expected: Schema.optionalKey(WorkspacePath),
      expectedDiagnostic: Schema.optionalKey(DiagnosticCode),
    }),
  ),
});
export type ConformancePackDocument = typeof ConformancePackDocument.Type;
