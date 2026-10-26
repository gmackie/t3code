import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import {
  error,
  sortDiagnostics,
  type DiagnosticCode,
  type ModelDiagnostic,
} from "./diagnostics.ts";
import {
  BlockCatalogDocument,
  ChartDocument,
  ConformancePackDocument,
  ExpectedTraceDocument,
  LayoutDocument,
  LockDocument,
  ProjectDocument,
  RunDocument,
  SystemDocument,
  type Action,
  type ChartTransition,
  type Expr,
} from "./documents.ts";
import { compare, isCanonical, sign, type RationalTime } from "./rational.ts";

/**
 * Static validation of RFC-001 authoring documents. Nothing here executes a model:
 * checks are schema, reference, hierarchy, unit-conversion and direct-feedthrough
 * analysis that a compiler front end runs before any backend sees the plan.
 */

export const documentSchemas = {
  "sw.system": SystemDocument,
  "sw.statechart": ChartDocument,
  "sw.run": RunDocument,
  "sw.expectedTrace": ExpectedTraceDocument,
  "sw.layout": LayoutDocument,
  "sw.blockCatalog": BlockCatalogDocument,
  "sw.lock": LockDocument,
  "sw.project": ProjectDocument,
  "sw.conformancePack": ConformancePackDocument,
} as const;
export type DocumentFormat = keyof typeof documentSchemas;
export type DocumentOf<F extends DocumentFormat> = (typeof documentSchemas)[F]["Type"];

const escapePointer = (segment: PropertyKey) =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
const pointer = (...segments: ReadonlyArray<PropertyKey>) =>
  segments.map((segment) => `/${escapePointer(segment)}`).join("");

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export interface Decoded<A> {
  readonly value: A | undefined;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

const STRICT = { onExcessProperty: "error", errors: "all" } as const;
const decoders = Object.fromEntries(
  Object.entries(documentSchemas).map(([format, schema]) => [
    format,
    Schema.decodeUnknownResult(schema),
  ]),
) as {
  readonly [F in DocumentFormat]: (
    input: unknown,
    options: typeof STRICT,
  ) => Result.Result<DocumentOf<F>, Schema.SchemaError>;
};

/** Decode one document strictly: unknown fields are `E-SCHEMA-001`, never ignored. */
export const decodeDocument = <F extends DocumentFormat>(
  format: F,
  input: unknown,
  file?: string,
): Decoded<DocumentOf<F>> => {
  const decoded = (
    decoders[format] as (
      input: unknown,
      options: typeof STRICT,
    ) => Result.Result<DocumentOf<F>, Schema.SchemaError>
  )(input, STRICT);
  if (Result.isSuccess(decoded)) return { value: decoded.success, diagnostics: [] };
  const diagnostics = formatIssues(decoded.failure.issue).issues.map((issue) =>
    error("E-SCHEMA-001", issue.message, {
      ...(file === undefined ? {} : { file }),
      pointer: pointer(
        ...(issue.path ?? []).map((segment) =>
          typeof segment === "object" ? segment.key : segment,
        ),
      ),
    }),
  );
  return { value: undefined, diagnostics: sortDiagnostics(diagnostics) };
};

/** Read the `format` discriminator so callers can decode a file without knowing its kind. */
export const documentFormat = (input: unknown): DocumentFormat | undefined => {
  if (typeof input !== "object" || input === null || !("format" in input)) return undefined;
  const format = input.format;
  return typeof format === "string" && format in documentSchemas
    ? (format as DocumentFormat)
    : undefined;
};

/** Workspace-relative, `/`-separated, no `.`/`..` segments: never escapes the project root. */
export const isNormalizedPath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !/^[a-zA-Z]:/.test(path) &&
  path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

class Collector {
  readonly diagnostics: Array<ModelDiagnostic> = [];
  readonly file: string | undefined;
  constructor(file: string | undefined) {
    this.file = file;
  }

  add(
    code: DiagnosticCode,
    message: string,
    location: { readonly elementId?: string; readonly pointer?: string } = {},
    extra: Pick<ModelDiagnostic, "related" | "fix"> = {},
  ) {
    this.diagnostics.push(
      error(code, message, {
        ...(this.file === undefined ? {} : { file: this.file }),
        ...location,
        ...extra,
      }),
    );
  }

  uniqueIds(items: ReadonlyArray<{ readonly id: string }>, path: string) {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id))
        this.add("E-REF-001", `Duplicate id "${item.id}"`, {
          elementId: item.id,
          pointer: pointer(path, index, "id"),
        });
      seen.add(item.id);
    });
    return seen;
  }

  rational(
    value: RationalTime,
    at: string,
    elementId: string | undefined,
    bound: "positive" | "nonNegative" | "any",
  ) {
    const location = { ...(elementId === undefined ? {} : { elementId }), pointer: at };
    if (!isCanonical(value)) {
      this.add("E-TIME-001", `Rational ${value.num}/${value.den} is not reduced`, location);
      return;
    }
    if (bound === "positive" && sign(value) <= 0)
      this.add(
        "E-TIME-001",
        `Expected a positive duration, got ${value.num}/${value.den}`,
        location,
      );
    if (bound === "nonNegative" && sign(value) < 0)
      this.add(
        "E-TIME-001",
        `Expected a non-negative time, got ${value.num}/${value.den}`,
        location,
      );
  }

  done() {
    return sortDiagnostics(this.diagnostics);
  }
}

// System graph

export interface Ports {
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
}

export interface SystemContext {
  readonly catalog: DocumentOf<"sw.blockCatalog">;
  /** Ports of an embedded chart, keyed by the node's `chart` parameter; overrides catalog ports. */
  readonly chartPorts?: (chartRef: string) => Ports | undefined;
}

const UNIT_PARAMETERS = ["unit", "fromUnit", "toUnit", "derivativeUnit", "gainUnit"] as const;
const CLOCK_PARAMETERS = ["clock", "sourceClock", "targetClock"] as const;
const TIME_DIMENSION = 2;

const stringParameter = (parameters: Readonly<Record<string, unknown>>, name: string) => {
  const value = parameters[name];
  return typeof value === "string" ? value : undefined;
};

export const validateSystem = (
  system: DocumentOf<"sw.system">,
  context: SystemContext,
  file?: string,
): ReadonlyArray<ModelDiagnostic> => {
  const out = new Collector(file);
  const units = context.catalog.units;
  const blockTypes = new Map(context.catalog.blockTypes.map((block) => [block.type, block]));
  const clockIds = out.uniqueIds(system.clocks, "clocks");
  const declaredNodes = out.uniqueIds(system.nodes, "nodes");
  out.uniqueIds(system.edges, "edges");
  out.uniqueIds(system.outputs ?? [], "outputs");

  system.clocks.forEach((clock, index) => {
    out.rational(clock.period, pointer("clocks", index, "period"), clock.id, "positive");
    out.rational(clock.offset, pointer("clocks", index, "offset"), clock.id, "nonNegative");
  });

  const nodes = new Map<string, { readonly ports: Ports; readonly feedthrough: boolean }>();
  system.nodes.forEach((node, index) => {
    const block = blockTypes.get(node.type);
    if (block === undefined) {
      out.add("E-REF-001", `Unknown block type "${node.type}"`, {
        elementId: node.id,
        pointer: pointer("nodes", index, "type"),
      });
      return;
    }
    const chartRef = stringParameter(node.parameters, "chart");
    const ports = (chartRef === undefined ? undefined : context.chartPorts?.(chartRef)) ?? block;
    nodes.set(node.id, { ports, feedthrough: block.feedthrough });

    for (const name of CLOCK_PARAMETERS) {
      const clock = stringParameter(node.parameters, name);
      if (clock !== undefined && !clockIds.has(clock))
        out.add("E-REF-001", `Unknown clock "${clock}"`, {
          elementId: node.id,
          pointer: pointer("nodes", index, "parameters", name),
        });
    }
    for (const name of UNIT_PARAMETERS) {
      const unit = stringParameter(node.parameters, name);
      if (unit !== undefined && units[unit] === undefined)
        out.add("E-UNIT-001", `Unit "${unit}" is not in library ${context.catalog.id}`, {
          elementId: node.id,
          pointer: pointer("nodes", index, "parameters", name),
        });
    }

    const from = units[stringParameter(node.parameters, "fromUnit") ?? ""];
    const to = units[stringParameter(node.parameters, "toUnit") ?? ""];
    if (from !== undefined && to !== undefined && from.dims.some((dim, i) => dim !== to.dims[i]))
      out.add(
        "E-UNIT-001",
        `Cannot convert ${node.parameters.fromUnit} to ${node.parameters.toUnit}: dimensions differ`,
        { elementId: node.id, pointer: pointer("nodes", index, "parameters") },
        {
          related: system.edges
            .filter((edge) => edge.to.node === node.id)
            .map((edge) => ({ elementId: edge.id })),
        },
      );

    // An integrator's state unit must be its derivative unit times seconds.
    const state = units[stringParameter(node.parameters, "unit") ?? ""];
    const derivative = units[stringParameter(node.parameters, "derivativeUnit") ?? ""];
    if (
      block.stateKind === "continuous" &&
      state !== undefined &&
      derivative !== undefined &&
      state.dims.some((dim, i) => dim !== derivative.dims[i]! + (i === TIME_DIMENSION ? 1 : 0))
    )
      out.add(
        "E-UNIT-001",
        `State unit ${node.parameters.unit} does not integrate ${node.parameters.derivativeUnit}`,
        { elementId: node.id, pointer: pointer("nodes", index, "parameters") },
      );
  });

  const drivenInputs = new Map<string, string>();
  system.edges.forEach((edge, index) => {
    const source = nodes.get(edge.from.node);
    const target = nodes.get(edge.to.node);
    const at = (side: "from" | "to") => ({
      elementId: edge.id,
      pointer: pointer("edges", index, side),
    });
    if (!declaredNodes.has(edge.from.node))
      out.add("E-REF-001", `Edge source node "${edge.from.node}" does not exist`, at("from"));
    else if (source !== undefined && !source.ports.outputs.includes(edge.from.port))
      out.add(
        source.ports.inputs.includes(edge.from.port) ? "E-TYPE-001" : "E-REF-001",
        source.ports.inputs.includes(edge.from.port)
          ? `"${edge.from.node}.${edge.from.port}" is an input and cannot drive an edge`
          : `"${edge.from.node}" has no output "${edge.from.port}"`,
        at("from"),
      );
    if (!declaredNodes.has(edge.to.node))
      out.add("E-REF-001", `Edge target node "${edge.to.node}" does not exist`, at("to"));
    else if (target !== undefined && !target.ports.inputs.includes(edge.to.port))
      out.add(
        target.ports.outputs.includes(edge.to.port) ? "E-TYPE-001" : "E-REF-001",
        target.ports.outputs.includes(edge.to.port)
          ? `"${edge.to.node}.${edge.to.port}" is an output and cannot be driven`
          : `"${edge.to.node}" has no input "${edge.to.port}"`,
        at("to"),
      );
    const input = `${edge.to.node}.${edge.to.port}`;
    const driver = drivenInputs.get(input);
    if (driver !== undefined)
      out.add("E-TYPE-001", `Input "${input}" is already driven by edge "${driver}"`, at("to"), {
        related: [{ elementId: driver }],
      });
    else drivenInputs.set(input, edge.id);
  });

  (system.outputs ?? []).forEach((output, index) => {
    const node = nodes.get(output.source.node);
    if (node === undefined || !node.ports.outputs.includes(output.source.port))
      out.add(
        "E-REF-001",
        `Probe source "${output.source.node}.${output.source.port}" does not exist`,
        {
          elementId: output.id,
          pointer: pointer("outputs", index, "source"),
        },
      );
  });

  for (const loop of algebraicLoops(system, nodes)) {
    out.add(
      "E-ALG-001",
      `Direct-feedthrough cycle through ${loop.nodes.join(", ")}; break it with a stateful block such as an integrator, delay or hold`,
      { elementId: loop.nodes[0]! },
      { related: [...loop.nodes, ...loop.edges].map((elementId) => ({ elementId })) },
    );
  }

  return out.done();
};

export interface AlgebraicLoop {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
}

/**
 * Strongly connected components of the instantaneous dependency graph (RFC-001 §5.3).
 * An edge into a non-feedthrough block (integrator, delay) carries no same-time
 * dependency, so cycles through one are not algebraic loops.
 */
export const algebraicLoops = (
  system: DocumentOf<"sw.system">,
  nodes: ReadonlyMap<string, { readonly feedthrough: boolean }>,
): ReadonlyArray<AlgebraicLoop> => {
  const instantaneous = system.edges.filter(
    (edge) => nodes.get(edge.to.node)?.feedthrough === true && nodes.has(edge.from.node),
  );
  const successors = new Map<string, Array<string>>();
  for (const edge of instantaneous)
    successors.set(edge.from.node, [...(successors.get(edge.from.node) ?? []), edge.to.node]);

  // Tarjan's algorithm over ids in sorted order, so results never depend on declaration order.
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: Array<string> = [];
  const components: Array<Array<string>> = [];
  let counter = 0;
  const visit = (id: string) => {
    index.set(id, counter);
    lowLink.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    for (const next of (successors.get(id) ?? []).toSorted()) {
      if (!index.has(next)) {
        visit(next);
        lowLink.set(id, Math.min(lowLink.get(id)!, lowLink.get(next)!));
      } else if (onStack.has(next)) lowLink.set(id, Math.min(lowLink.get(id)!, index.get(next)!));
    }
    if (lowLink.get(id) === index.get(id)) {
      const component: Array<string> = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component);
    }
  };
  for (const id of [...nodes.keys()].toSorted()) if (!index.has(id)) visit(id);

  return components
    .map((component) => new Set(component))
    .flatMap((members) => {
      const edges = instantaneous
        .filter((edge) => members.has(edge.from.node) && members.has(edge.to.node))
        .map((edge) => edge.id)
        .toSorted();
      // A single node is a loop only when it feeds itself.
      return members.size > 1 || edges.length > 0
        ? [{ nodes: [...members].toSorted(), edges }]
        : [];
    })
    .toSorted((a, b) => (a.nodes[0]! < b.nodes[0]! ? -1 : 1));
};

// Statecharts

const triggerKey = (transition: ChartTransition) => {
  const trigger = transition.trigger;
  switch (trigger.kind) {
    case "always":
      return "always";
    case "after":
      return `after:${trigger.duration.num}/${trigger.duration.den}`;
    default:
      return `${trigger.kind}:${trigger.id}`;
  }
};

export const chartPorts = (chart: DocumentOf<"sw.statechart">): Ports => ({
  inputs: chart.interface.inputs.map((input) => input.id),
  outputs: chart.interface.outputs.map((output) => output.id),
});

export const validateChart = (
  chart: DocumentOf<"sw.statechart">,
  file?: string,
): ReadonlyArray<ModelDiagnostic> => {
  const out = new Collector(file);
  const states = new Map(chart.states.map((state) => [state.id, state]));
  const stateIndex = new Map(chart.states.map((state, index) => [state.id, index]));
  out.uniqueIds(chart.states, "states");
  out.uniqueIds(chart.transitions, "transitions");
  const inputs = out.uniqueIds(chart.interface.inputs, "interface/inputs");
  const outputs = out.uniqueIds(chart.interface.outputs, "interface/outputs");
  const events = out.uniqueIds(chart.interface.events, "interface/events");

  const root = states.get(chart.root);
  if (root === undefined)
    out.add("E-CHART-001", `Root state "${chart.root}" does not exist`, {
      pointer: pointer("root"),
    });
  else if (root.type !== "compound" || root.parent !== undefined)
    out.add("E-CHART-001", "The root state must be a compound state without a parent", {
      elementId: root.id,
      pointer: pointer("states", stateIndex.get(root.id)!),
    });

  chart.states.forEach((state, index) => {
    const at = (field?: string) => ({
      elementId: state.id,
      pointer: field === undefined ? pointer("states", index) : pointer("states", index, field),
    });
    if (state.id !== chart.root) {
      const parent = state.parent === undefined ? undefined : states.get(state.parent);
      if (parent === undefined)
        out.add("E-CHART-001", `State "${state.id}" needs an existing parent state`, at("parent"));
      else if (parent.type !== "compound")
        out.add(
          "E-CHART-001",
          `Parent "${parent.id}" of "${state.id}" is not compound`,
          at("parent"),
        );
      else if (!reachesRoot(state.id, states, chart.root))
        out.add(
          "E-CHART-001",
          `State "${state.id}" is not under root "${chart.root}"`,
          at("parent"),
        );
    }
    if (state.type === "compound") {
      const initial = state.initial === undefined ? undefined : states.get(state.initial);
      if (initial?.parent !== state.id)
        out.add(
          "E-CHART-001",
          `Compound state "${state.id}" needs an initial child`,
          at("initial"),
        );
    } else if (state.initial !== undefined)
      out.add(
        "E-CHART-001",
        `Atomic state "${state.id}" cannot declare an initial child`,
        at("initial"),
      );
    for (const list of ["entry", "exit"] as const)
      state[list]?.forEach((action, actionIndex) =>
        checkAction(
          out,
          action,
          { inputs, outputs, events },
          state.id,
          pointer("states", index, list, actionIndex),
        ),
      );
  });

  const priorities = new Map<string, string>();
  chart.transitions.forEach((transition, index) => {
    const at = (field: string) => ({
      elementId: transition.id,
      pointer: pointer("transitions", index, field),
    });
    for (const end of ["source", "target"] as const)
      if (!states.has(transition[end]))
        out.add("E-REF-001", `Transition ${end} "${transition[end]}" does not exist`, at(end));
    if (transition.kind === "internal" && transition.source !== transition.target)
      out.add("E-CHART-001", "An internal transition must target its own source state", at("kind"));

    const trigger = transition.trigger;
    if (trigger.kind === "event" && !events.has(trigger.id))
      out.add(
        "E-REF-001",
        `Event "${trigger.id}" is not declared in the chart interface`,
        at("trigger"),
      );
    if (trigger.kind === "after")
      out.rational(
        trigger.duration,
        pointer("transitions", index, "trigger", "duration"),
        transition.id,
        "positive",
      );

    const key = `${transition.source}\u0000${triggerKey(transition)}\u0000${transition.priority}`;
    const other = priorities.get(key);
    if (other !== undefined)
      out.add(
        "E-CHART-002",
        `Transitions "${other}" and "${transition.id}" share source, trigger and priority ${transition.priority}`,
        at("priority"),
        { related: [{ elementId: other }] },
      );
    else priorities.set(key, transition.id);

    if (transition.guard !== undefined)
      checkExpr(
        out,
        transition.guard,
        { inputs, outputs },
        transition.id,
        pointer("transitions", index, "guard"),
      );
    transition.actions?.forEach((action, actionIndex) =>
      checkAction(
        out,
        action,
        { inputs, outputs, events },
        transition.id,
        pointer("transitions", index, "actions", actionIndex),
      ),
    );
  });

  return out.done();
};

const reachesRoot = (
  id: string,
  states: ReadonlyMap<string, { readonly parent?: string }>,
  root: string,
): boolean => {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    if (current === root) return true;
    seen.add(current);
    current = states.get(current)?.parent;
  }
  return false;
};

interface Scope {
  readonly inputs: ReadonlySet<string>;
  readonly outputs: ReadonlySet<string>;
}

const checkReference = (
  out: Collector,
  path: string,
  scope: Scope,
  elementId: string,
  at: string,
) => {
  const [namespace, name, ...rest] = path.split(".");
  const declared =
    rest.length === 0 &&
    name !== undefined &&
    ((namespace === "input" && scope.inputs.has(name)) ||
      (namespace === "output" && scope.outputs.has(name)));
  if (!declared)
    out.add("E-REF-001", `Reference "${path}" is not a declared input or output`, {
      elementId,
      pointer: at,
    });
};

const checkExpr = (
  out: Collector,
  expr: Expr,
  scope: Scope,
  elementId: string,
  at: string,
): void => {
  switch (expr.op) {
    case "literal":
      return;
    case "ref":
      return checkReference(out, expr.path, scope, elementId, `${at}/path`);
    case "not":
      return checkExpr(out, expr.arg, scope, elementId, `${at}/arg`);
    default:
      checkExpr(out, expr.left, scope, elementId, `${at}/left`);
      checkExpr(out, expr.right, scope, elementId, `${at}/right`);
  }
};

const checkAction = (
  out: Collector,
  action: Action,
  scope: Scope & { readonly events: ReadonlySet<string> },
  elementId: string,
  at: string,
) => {
  if (action.op === "emit") {
    if (!scope.events.has(action.eventId))
      out.add("E-REF-001", `Event "${action.eventId}" is not declared in the chart interface`, {
        elementId,
        pointer: at,
      });
    return;
  }
  if (action.target.startsWith("input."))
    out.add("E-TYPE-001", `Chart inputs are read-only; cannot assign "${action.target}"`, {
      elementId,
      pointer: at,
    });
  else checkReference(out, action.target, scope, elementId, `${at}/target`);
  checkExpr(out, action.value, scope, elementId, `${at}/value`);
};

// Experiments and expected traces

export const validateRun = (
  run: DocumentOf<"sw.run">,
  file?: string,
): ReadonlyArray<ModelDiagnostic> => {
  const out = new Collector(file);
  if ((run.modelRef === undefined) === (run.chartRef === undefined))
    out.add("E-SCHEMA-001", "A run names exactly one of modelRef and chartRef", {
      elementId: run.id,
    });
  out.rational(run.start, pointer("start"), run.id, "nonNegative");
  out.rational(run.stop, pointer("stop"), run.id, "any");
  if (compare(run.start, run.stop) >= 0)
    out.add("E-TIME-001", "Run stop must be after its start", {
      elementId: run.id,
      pointer: pointer("stop"),
    });
  if (run.solver.fixedStep !== undefined)
    out.rational(run.solver.fixedStep, pointer("solver", "fixedStep"), run.id, "positive");
  else if (run.solver.method === "rk4-fixed@1")
    out.add("E-SCHEMA-001", "rk4-fixed@1 needs solver.fixedStep", {
      elementId: run.id,
      pointer: pointer("solver"),
    });
  run.inputs.forEach((input, index) => {
    out.rational(input.time, pointer("inputs", index, "time"), run.id, "any");
    if (compare(input.time, run.start) < 0 || compare(input.time, run.stop) > 0)
      out.add("E-TIME-001", "Input event lies outside the run interval", {
        elementId: run.id,
        pointer: pointer("inputs", index, "time"),
      });
  });
  return out.done();
};

export const validateTrace = (
  trace: DocumentOf<"sw.expectedTrace">,
  file?: string,
): ReadonlyArray<ModelDiagnostic> => {
  const out = new Collector(file);
  trace.observations.forEach((observation, index) => {
    out.rational(observation.time, pointer("observations", index, "time"), trace.fixtureId, "any");
    const previous = trace.observations[index - 1];
    if (previous !== undefined && compare(previous.time, observation.time) >= 0)
      out.add("E-TIME-001", "Observations must be in strictly increasing time order", {
        elementId: trace.fixtureId,
        pointer: pointer("observations", index, "time"),
      });
  });
  trace.expectedTransitions.forEach((transition, index) =>
    out.rational(
      transition.time,
      pointer("expectedTransitions", index, "time"),
      transition.transitionId,
      "any",
    ),
  );
  return out.done();
};
