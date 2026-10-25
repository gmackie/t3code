import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  error,
  hasErrors,
  sortDiagnostics,
  type ModelDiagnostic,
} from "@t3tools/systems-model/diagnostics";
import type {
  BlockCatalogDocument,
  ChartDocument,
  ClockSpec,
  PortRef,
  SystemDocument,
} from "@t3tools/systems-model/documents";
import { diagnosticsFor, type Pack } from "@t3tools/systems-model/pack";
import { algebraicLoops } from "@t3tools/systems-model/validate";

import { checkChart, parseDomain } from "./chart.ts";
import { digest } from "./json.ts";
import { nodeParameters, semanticNormalize } from "./normalize.ts";
import {
  BLOCK_SEMANTICS,
  type BlockSemantics,
  type ClockAction,
  type Domain,
  type Expectation,
  type Parameters,
  type Port,
  type ValueType,
} from "./semantics.ts";
import { convertible, DIMENSIONLESS, sameUnit, unitOf, type UnitTable } from "./units.ts";

/**
 * The normalizing compiler of RFC-001 §5.2: resolve the locked closure, type ports, check
 * units, clock domains and causality, then emit a plain-data plan with digests. Its output
 * crosses worker boundaries, so every resolved shape is JSON-serialisable.
 */

export type { ClockAction, Domain } from "./semantics.ts";

export const COMPILER_VERSION = "systems-compiler@0.1.0";

export interface SourceLocation {
  readonly file: string;
  /** JSON Pointer into the authored (not normalized) document. */
  readonly pointer: string;
}

export interface ResolvedPort {
  /** Catalog unit symbol; a derived unit with no catalog name is written `a*b`. */
  readonly unit: string;
  readonly valueType: ValueType;
  readonly domain: Domain;
}

export interface ResolvedInput extends ResolvedPort {
  /** The single edge driving this input, and the output it reads. */
  readonly edge: string;
  readonly from: PortRef;
}

export interface ResolvedNode {
  readonly id: string;
  readonly type: string;
  /** Authored parameters with the block's semantic defaults inserted. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Clock partition the node executes in; absent for continuous and constant nodes. */
  readonly clock?: string;
  readonly inputs: Readonly<Record<string, ResolvedInput>>;
  readonly outputs: Readonly<Record<string, ResolvedPort>>;
}

export interface ClockStep {
  readonly node: string;
  /**
   * `sample` captures a pre-boundary value (continuous at t⁻, or a rate transition's
   * previously committed source); `chart` runs the chart on this tick; `evaluate` is pure;
   * `stage` computes a hold or register's next value, committed with the partition.
   */
  readonly action: ClockAction;
}

export interface ResolvedOutput extends ResolvedPort {
  readonly id: string;
  readonly source: PortRef;
}

export interface LibraryDigest {
  readonly name: string;
  readonly version: string;
  /** `sha256:<hex>` of the library file's bytes, as pinned by the lock. */
  readonly digest: string;
}

export interface ResolvedChart {
  readonly chartRef: string;
  /** Digest of the normalized chart alone. */
  readonly semanticDigest: string;
  /** Adds the compiler version and the locked libraries. */
  readonly planDigest: string;
  /** Normalized: interface, states and transitions sorted by id; defaults inserted. */
  readonly chart: ChartDocument;
  readonly sourceMap: {
    readonly states: Readonly<Record<string, SourceLocation>>;
    readonly transitions: Readonly<Record<string, SourceLocation>>;
  };
}

export interface ResolvedSystem {
  readonly systemId: string;
  readonly entry: string;
  /** Normalized system + referenced charts + locked library digests; never layout. */
  readonly semanticDigest: string;
  /** Adds the compiler version, so a compiler change yields a new plan. */
  readonly planDigest: string;
  readonly compilerVersion: string;
  readonly libraries: ReadonlyArray<LibraryDigest>;
  /** Sorted by `(priority, id)`: the order tied clocks execute in (RFC-001 §6.2). */
  readonly clocks: ReadonlyArray<ClockSpec>;
  readonly nodes: Readonly<Record<string, ResolvedNode>>;
  /** Embedded charts by statechart node id. */
  readonly charts: Readonly<Record<string, ResolvedChart>>;
  /**
   * Evaluation order of continuous and constant nodes. Integrators follow the nodes that
   * drive their derivative; their own outputs, and holds', are state and need no step.
   */
  readonly continuousOrder: ReadonlyArray<string>;
  /** Phase D causal order per clock: samples, upstream blocks, charts, downstream, staged. */
  readonly clockSchedules: Readonly<Record<string, ReadonlyArray<ClockStep>>>;
  readonly outputs: ReadonlyArray<ResolvedOutput>;
  readonly sourceMap: {
    readonly clocks: Readonly<Record<string, SourceLocation>>;
    readonly nodes: Readonly<Record<string, SourceLocation>>;
    readonly edges: Readonly<Record<string, SourceLocation>>;
    readonly outputs: Readonly<Record<string, SourceLocation>>;
  };
}

export interface Compiled<A> {
  readonly resolved?: A;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

// Locked closure

interface Library extends LibraryDigest {
  readonly catalog: BlockCatalogDocument;
}

/** Libraries whose bytes the pack verified against their lock, in name order. */
const lockedLibraries = (pack: Pack): ReadonlyArray<Library> =>
  pack.libraries
    .map((library) => ({
      name: library.name,
      version: library.version,
      digest: `sha256:${library.sha256}`,
      catalog: library.catalog,
    }))
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const libraryDigests = (libraries: ReadonlyArray<Library>): ReadonlyArray<LibraryDigest> =>
  libraries.map(({ name, version, digest }) => ({ name, version, digest }));

const unitTable = (libraries: ReadonlyArray<Library>): UnitTable =>
  Object.assign({}, ...libraries.map((library) => library.catalog.units));

const chartDocument = (pack: Pack, ref: string) => {
  const loaded = pack.documents.get(ref);
  return loaded?.format === "sw.statechart" ? loaded.value : undefined;
};

const indexed = <A extends { readonly id: string }>(
  items: ReadonlyArray<A>,
  file: string,
  path: string,
): Record<string, SourceLocation> =>
  Object.fromEntries(
    items
      .map((item, index) => [item.id, { file, pointer: `/${path}/${index}` }] as const)
      .toSorted(([a], [b]) => (a < b ? -1 : 1)),
  );

// Charts

const resolveChart = Effect.fn("systemsCompiler.resolveChart")(function* (
  chartRef: string,
  chart: ChartDocument,
  libraries: ReadonlyArray<LibraryDigest>,
) {
  const normalized = semanticNormalize(chart);
  const semanticDigest = yield* digest({ chart: normalized });
  const planDigest = yield* digest({ compiler: COMPILER_VERSION, semanticDigest, libraries });
  return {
    chartRef,
    semanticDigest,
    planDigest,
    chart: normalized,
    sourceMap: {
      states: indexed(chart.states, chartRef, "states"),
      transitions: indexed(chart.transitions, chartRef, "transitions"),
    },
  } satisfies ResolvedChart;
});

/** Compile a standalone chart, e.g. for a chart-only run. */
export const compileChart = Effect.fn("systemsCompiler.compileChart")(function* (
  pack: Pack,
  chartRef: string,
) {
  const chart = chartDocument(pack, chartRef);
  const packDiagnostics = diagnosticsFor(pack, chartRef);
  if (chart === undefined)
    return {
      diagnostics: sortDiagnostics([
        ...packDiagnostics,
        error("E-REF-001", `"${chartRef}" is not a valid sw.statechart document`, {
          file: chartRef,
        }),
      ]),
    } satisfies Compiled<ResolvedChart>;
  const libraries = lockedLibraries(pack);
  const diagnostics = sortDiagnostics([
    ...packDiagnostics,
    ...checkChart(chart, chartRef, { units: unitTable(libraries) }),
  ]);
  if (hasErrors(diagnostics)) return { diagnostics } satisfies Compiled<ResolvedChart>;
  const resolved = yield* resolveChart(chartRef, chart, libraryDigests(libraries));
  return { resolved, diagnostics } satisfies Compiled<ResolvedChart>;
});

// Systems

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

interface NodeInfo {
  readonly index: number;
  readonly id: string;
  readonly type: string;
  readonly semantics: BlockSemantics;
  readonly parameters: Parameters;
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
  readonly chart?: ChartDocument;
}

const sameMembers = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((item) => b.includes(item));

const isNumeric = (valueType: ValueType) => valueType !== "bool" && valueType !== "string";

const clockOfDomain = (domain: Domain) =>
  domain.startsWith("clocked:") ? domain.slice("clocked:".length) : undefined;

/** The explicit adapter RFC-001 §4.4 requires for a crossing, as a suggestion. */
const crossingFix = (
  from: Domain,
  to: Domain,
  edge: string,
): NonNullable<ModelDiagnostic["fix"]> => {
  const source = clockOfDomain(from);
  const target = clockOfDomain(to);
  if (from === "continuous" && target !== undefined)
    return {
      kind: "insert-block",
      explanation: `Insert std.sample@1 with clock "${target}" on edge ${edge}`,
    };
  if (source !== undefined && to === "continuous")
    return {
      kind: "insert-block",
      explanation: `Insert std.hold@1 with clock "${source}" and an explicit initial value on edge ${edge}`,
    };
  if (source !== undefined && target !== undefined)
    return {
      kind: "insert-block",
      explanation: `Insert std.rate_transition@1 from "${source}" to "${target}" (policy previous_committed) on edge ${edge}`,
    };
  return {
    kind: "use-event-trigger",
    explanation: `Deliver ${from} values through a chart event trigger, not signal edge ${edge}`,
  };
};

/**
 * Topological order of `members` over same-time dependencies: an edge from a stateless
 * node. Ready nodes run by `(rank, id)`, so independent nodes never depend on file order.
 */
const schedule = (
  system: SystemDocument,
  members: ReadonlyMap<string, NodeInfo>,
  rank: (info: NodeInfo) => number,
): ReadonlyArray<string> => {
  const successors = new Map<string, Array<string>>();
  const pending = new Map([...members.keys()].map((id) => [id, 0]));
  for (const edge of system.edges) {
    const from = members.get(edge.from.node);
    if (from === undefined || from.semantics.stateful || !members.has(edge.to.node)) continue;
    successors.set(from.id, [...(successors.get(from.id) ?? []), edge.to.node]);
    pending.set(edge.to.node, pending.get(edge.to.node)! + 1);
  }
  const key = (id: string) => [rank(members.get(id)!), id] as const;
  const before = (a: string, b: string) => {
    const [ra, ia] = key(a);
    const [rb, ib] = key(b);
    return ra !== rb ? ra - rb : ia < ib ? -1 : 1;
  };
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  const order: Array<string> = [];
  while (ready.length > 0) {
    ready.sort(before);
    const id = ready.shift()!;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const count = pending.get(next)! - 1;
      pending.set(next, count);
      if (count === 0) ready.push(next);
    }
  }
  return order;
};

const ACTION_RANK: Record<ClockAction, number> = { sample: 0, evaluate: 1, chart: 1, stage: 2 };

interface Analysis {
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
  readonly build: () => Omit<
    ResolvedSystem,
    "semanticDigest" | "planDigest" | "compilerVersion" | "libraries" | "charts"
  >;
  readonly charts: ReadonlyMap<string, { readonly ref: string; readonly chart: ChartDocument }>;
}

const analyzeSystem = (
  pack: Pack,
  file: string,
  system: SystemDocument,
  libraries: ReadonlyArray<Library>,
): Analysis => {
  const diagnostics: Array<ModelDiagnostic> = [];
  const report = (
    code: ModelDiagnostic["code"],
    message: string,
    elementId: string,
    pointer: string,
    extra: Pick<ModelDiagnostic, "related" | "fix"> = {},
  ) => diagnostics.push(error(code, message, { file, elementId, pointer, ...extra }));

  const units = unitTable(libraries);
  const blockTypes = new Map(
    libraries.flatMap((library) => library.catalog.blockTypes.map((block) => [block.type, block])),
  );
  const clockIds = new Set(system.clocks.map((clock) => clock.id));

  const infos = new Map<string, NodeInfo>();
  const charts = new Map<string, { ref: string; chart: ChartDocument }>();
  system.nodes.forEach((node, index) => {
    const block = blockTypes.get(node.type);
    // Unknown types and duplicate ids are systems-model's E-REF-001.
    if (block === undefined || infos.has(node.id)) return;
    const semantics = BLOCK_SEMANTICS[node.type];
    if (semantics === undefined) {
      report(
        "E-TARGET-001",
        `No compiler semantics for block type "${node.type}"`,
        node.id,
        `/nodes/${index}/type`,
      );
      return;
    }
    const parameters = nodeParameters(node);
    const decoded = semantics.decode(parameters);
    if (Result.isFailure(decoded)) {
      for (const issue of formatIssues(decoded.failure.issue).issues)
        report(
          "E-SCHEMA-001",
          issue.message,
          node.id,
          [
            `/nodes/${index}/parameters`,
            ...(issue.path ?? []).map((segment) =>
              String(typeof segment === "object" ? segment.key : segment),
            ),
          ].join("/"),
        );
      return;
    }
    if (semantics.ports === undefined) {
      const ref = String(parameters.chart);
      const chart = chartDocument(pack, ref);
      if (chart === undefined) return;
      charts.set(node.id, { ref, chart });
      infos.set(node.id, {
        index,
        id: node.id,
        type: node.type,
        semantics,
        parameters,
        inputs: chart.interface.inputs.map((variable) => variable.id),
        outputs: chart.interface.outputs.map((variable) => variable.id),
        chart,
      });
      return;
    }
    if (
      !sameMembers(semantics.ports.inputs, block.inputs) ||
      !sameMembers(semantics.ports.outputs, block.outputs)
    ) {
      report(
        "E-TARGET-001",
        `Library ports of "${node.type}" do not match the compiler's semantics`,
        node.id,
        `/nodes/${index}/type`,
      );
      return;
    }
    infos.set(node.id, {
      index,
      id: node.id,
      type: node.type,
      semantics,
      parameters,
      inputs: semantics.ports.inputs,
      outputs: semantics.ports.outputs,
    });
  });

  const drivers = new Map<string, { readonly edge: SignalEdge; readonly index: number }>();
  system.edges.forEach((edge, index) => {
    const key = `${edge.to.node}\u0000${edge.to.port}`;
    if (!drivers.has(key)) drivers.set(key, { edge, index });
  });
  const driverOf = (node: string, port: string) => drivers.get(`${node}\u0000${port}`);

  const chartVariable = (info: NodeInfo, side: "inputs" | "outputs", port: string) =>
    info.chart?.interface[side].find((variable) => variable.id === port);
  const chartDomain = (info: NodeInfo, domain: string | undefined): Domain => {
    const clock = typeof info.parameters.clock === "string" ? info.parameters.clock : undefined;
    return (domain === undefined ? undefined : parseDomain(domain)) ?? `clocked:${clock ?? ""}`;
  };
  const chartPort = (
    info: NodeInfo,
    side: "inputs" | "outputs",
    port: string,
  ): Port | undefined => {
    const variable = chartVariable(info, side, port);
    if (variable === undefined) return undefined;
    return {
      unit: unitOf(units, variable.unit ?? DIMENSIONLESS),
      valueType: variable.type,
      domain: chartDomain(info, variable.domain),
    };
  };

  // Output ports, iterated to a fixed point so loops through stateful blocks still
  // inherit units and domains; a pure loop never settles and is E-ALG-001 below.
  const resolvedOutputs = new Map<string, Readonly<Record<string, Port>>>();
  const outputsOf = (id: string) => resolvedOutputs.get(id);
  const outputPort = (ref: PortRef) => outputsOf(ref.node)?.[ref.port];
  const joinDomain = (ports: ReadonlyArray<Port | undefined>): Domain =>
    ports.find((port) => port !== undefined && port.domain !== "constant")?.domain ?? "constant";
  const computeOutputs = (info: NodeInfo): Readonly<Record<string, Port>> => {
    const rules = info.semantics.ports;
    if (rules === undefined)
      return Object.fromEntries(
        info.outputs.flatMap((port) => {
          const resolved = chartPort(info, "outputs", port);
          return resolved === undefined ? [] : [[port, resolved] as const];
        }),
      );
    const inputs = Object.fromEntries(
      info.inputs.map((port) => {
        const driver = driverOf(info.id, port);
        return [port, driver === undefined ? undefined : outputPort(driver.edge.from)] as const;
      }),
    );
    const port = rules.output(
      { parameters: info.parameters, units },
      inputs,
      joinDomain(Object.values(inputs)),
    );
    return Object.fromEntries(info.outputs.map((name) => [name, port] as const));
  };
  const samePorts = (
    a: Readonly<Record<string, Port>> | undefined,
    b: Readonly<Record<string, Port>>,
  ) =>
    a !== undefined &&
    Object.entries(b).every(([name, port]) => {
      const other = a[name];
      return (
        other !== undefined &&
        other.unit.symbol === port.unit.symbol &&
        other.valueType === port.valueType &&
        other.domain === port.domain
      );
    });
  for (let round = 0; round <= infos.size; round++) {
    let changed = false;
    for (const info of infos.values()) {
      const next = computeOutputs(info);
      if (samePorts(resolvedOutputs.get(info.id), next)) continue;
      resolvedOutputs.set(info.id, next);
      changed = true;
    }
    if (!changed) break;
  }

  // Every input: driven once, with a matching value type, unit and domain.
  for (const info of infos.values()) {
    const rules = info.semantics.ports;
    const seen: Record<string, Port | undefined> = {};
    if (rules === undefined && info.parameters.clock === undefined) {
      const undeclared = [...info.chart!.interface.inputs, ...info.chart!.interface.outputs].find(
        (variable) => variable.domain === undefined,
      );
      if (undeclared !== undefined)
        report(
          "E-CLOCK-001",
          `Chart variable "${undeclared.id}" has no domain and node "${info.id}" has no clock`,
          info.id,
          `/nodes/${info.index}/parameters`,
          {
            fix: {
              kind: "set-parameter",
              explanation: `Give "${info.id}" a clock parameter, or declare a domain on each chart variable`,
            },
          },
        );
    }
    for (const port of info.inputs) {
      const driver = driverOf(info.id, port);
      if (driver === undefined) {
        report(
          "E-REF-001",
          `Input "${info.id}.${port}" is not driven by any edge`,
          info.id,
          `/nodes/${info.index}`,
        );
        continue;
      }
      const actual = outputPort(driver.edge.from);
      seen[port] = actual;
      if (actual === undefined) continue;
      let expected: Expectation;
      if (rules === undefined) {
        const variable = chartVariable(info, "inputs", port)!;
        expected = {
          ...(variable.type === "bool"
            ? { valueType: "bool" }
            : variable.type === "string"
              ? {}
              : { valueType: "numeric" }),
          unit: unitOf(units, variable.unit ?? DIMENSIONLESS),
          domain: chartDomain(info, variable.domain),
        };
      } else {
        const own = rules.expect({ parameters: info.parameters, units }, port, seen);
        const inherited = info.semantics.inheritsDomain
          ? joinDomain(info.inputs.slice(0, info.inputs.indexOf(port)).map((name) => seen[name]))
          : undefined;
        expected =
          inherited === undefined || inherited === "constant" ? own : { ...own, domain: inherited };
      }
      const edge = driver.edge;
      const at = `/edges/${driver.index}`;
      const into = `${info.id}.${port}`;
      const typeMismatch =
        expected.valueType === "bool"
          ? actual.valueType !== "bool"
          : expected.valueType === "numeric" && !isNumeric(actual.valueType);
      if (typeMismatch)
        report(
          "E-TYPE-001",
          `Edge ${edge.id} carries ${actual.valueType} but ${into} expects ${expected.valueType === "bool" ? "bool" : "a number"}`,
          edge.id,
          at,
        );
      else if (expected.unit !== undefined && !sameUnit(actual.unit, expected.unit))
        report(
          "E-UNIT-001",
          `Edge ${edge.id} carries ${actual.unit.symbol} but ${into} expects ${expected.unit.symbol}`,
          edge.id,
          at,
          convertible(actual.unit, expected.unit)
            ? {
                fix: {
                  kind: "insert-block",
                  explanation: `Insert std.unit_convert@1 from ${actual.unit.symbol} to ${expected.unit.symbol} on edge ${edge.id}`,
                },
              }
            : {},
        );
      if (
        expected.domain !== undefined &&
        actual.domain !== "constant" &&
        actual.domain !== expected.domain
      )
        report(
          "E-CLOCK-001",
          `Edge ${edge.id} crosses from ${actual.domain} to ${expected.domain} at ${into} without an adapter`,
          edge.id,
          at,
          { fix: crossingFix(actual.domain, expected.domain, edge.id) },
        );
    }
  }

  // RFC-001 §5.3 over this registry's feedthrough, where holds break loops (decision 2).
  for (const loop of algebraicLoops(
    system,
    new Map([...infos].map(([id, info]) => [id, { feedthrough: !info.semantics.stateful }])),
  ))
    diagnostics.push(
      error(
        "E-ALG-001",
        `Direct-feedthrough cycle through ${loop.nodes.join(", ")}; break it with a stateful block such as an integrator, delay or hold`,
        {
          file,
          elementId: loop.nodes[0]!,
          related: [...loop.nodes, ...loop.edges].map((elementId) => ({ elementId })),
        },
      ),
    );

  const clocks = system.clocks.toSorted((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1,
  );
  const partitionOf = (info: NodeInfo) =>
    info.semantics.clock(info.parameters) ??
    (info.semantics.ports === undefined
      ? undefined
      : clockOfDomain(outputsOf(info.id)?.value?.domain ?? "constant"));

  const build = () => {
    const toResolved = (port: Port): ResolvedPort => ({
      unit: port.unit.symbol,
      valueType: port.valueType,
      domain: port.domain,
    });
    const nodes: Record<string, ResolvedNode> = {};
    for (const info of [...infos.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
      const clock = partitionOf(info);
      nodes[info.id] = {
        id: info.id,
        type: info.type,
        parameters: info.parameters,
        ...(clock === undefined ? {} : { clock }),
        inputs: Object.fromEntries(
          info.inputs.map((port) => {
            const { edge } = driverOf(info.id, port)!;
            return [
              port,
              { ...toResolved(outputPort(edge.from)!), edge: edge.id, from: edge.from },
            ] as const;
          }),
        ),
        outputs: Object.fromEntries(
          Object.entries(outputsOf(info.id) ?? {}).map(
            ([port, resolved]) => [port, toResolved(resolved)] as const,
          ),
        ),
      };
    }
    // Stateless charts with no clock react to events only and join no partition.
    const continuous = new Map(
      [...infos].filter(([, info]) => partitionOf(info) === undefined && info.chart === undefined),
    );
    const clockSchedules = Object.fromEntries(
      clocks.map((clock) => {
        const members = new Map([...infos].filter(([, info]) => partitionOf(info) === clock.id));
        const order = schedule(system, members, (info) => ACTION_RANK[info.semantics.action]);
        return [
          clock.id,
          order.map((node) => ({ node, action: members.get(node)!.semantics.action })),
        ] as const;
      }),
    );
    return {
      systemId: system.id,
      entry: file,
      clocks,
      nodes,
      continuousOrder: schedule(system, continuous, () => 0),
      clockSchedules,
      outputs: (system.outputs ?? [])
        .map((output) => ({
          id: output.id,
          source: output.source,
          ...toResolved(outputPort(output.source)!),
        }))
        .toSorted((a, b) => (a.id < b.id ? -1 : 1)),
      sourceMap: {
        clocks: indexed(system.clocks, file, "clocks"),
        nodes: indexed(system.nodes, file, "nodes"),
        edges: indexed(system.edges, file, "edges"),
        outputs: indexed(system.outputs ?? [], file, "outputs"),
      },
    };
  };

  for (const { ref, chart } of new Map(
    [...charts.values()].map((entry) => [entry.ref, entry]),
  ).values())
    diagnostics.push(...checkChart(chart, ref, { units, clocks: clockIds }));

  return { diagnostics, build, charts };
};

type SignalEdge = SystemDocument["edges"][number];

/** Compile the system at `entry` and the charts it embeds. */
export const compileSystem = Effect.fn("systemsCompiler.compileSystem")(function* (
  pack: Pack,
  entry: string,
) {
  const loaded = pack.documents.get(entry);
  // The compiler owns causality: systems-model's coarse catalog feedthrough is superseded.
  const packDiagnostics = diagnosticsFor(pack, entry).filter(
    (diagnostic) => diagnostic.code !== "E-ALG-001",
  );
  if (loaded?.format !== "sw.system")
    return {
      diagnostics: sortDiagnostics([
        ...packDiagnostics,
        error("E-REF-001", `"${entry}" is not a valid sw.system document`, { file: entry }),
      ]),
    } satisfies Compiled<ResolvedSystem>;
  const system = loaded.value;
  const libraries = lockedLibraries(pack);
  const analysis = analyzeSystem(pack, entry, system, libraries);
  const diagnostics = sortDiagnostics([...packDiagnostics, ...analysis.diagnostics]);
  if (hasErrors(diagnostics)) return { diagnostics } satisfies Compiled<ResolvedSystem>;

  const digests = libraryDigests(libraries);
  const byRef = new Map<string, ResolvedChart>();
  const charts: Record<string, ResolvedChart> = {};
  for (const [node, { ref, chart }] of [...analysis.charts].toSorted(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const resolved = byRef.get(ref) ?? (yield* resolveChart(ref, chart, digests));
    byRef.set(ref, resolved);
    charts[node] = resolved;
  }
  const semanticDigest = yield* digest({
    system: semanticNormalize(system),
    charts: Object.fromEntries([...byRef].map(([ref, resolved]) => [ref, resolved.chart])),
    libraries: digests,
  });
  const planDigest = yield* digest({
    compiler: COMPILER_VERSION,
    semanticDigest,
    libraries: digests,
  });
  const resolved: ResolvedSystem = {
    ...analysis.build(),
    semanticDigest,
    planDigest,
    compilerVersion: COMPILER_VERSION,
    libraries: digests,
    charts,
  };
  return { resolved, diagnostics } satisfies Compiled<ResolvedSystem>;
});
