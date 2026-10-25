import type { ChartDocument, SystemDocument } from "@t3tools/systems-model/documents";

import { canonicalize } from "./json.ts";
import { semanticNormalize } from "./normalize.ts";

/**
 * Element-level semantic change between two revisions of one document, for review and
 * agent summaries. Compares normal forms, so layout, titles and ordering never show up.
 */

export type DiffKind =
  | "clocks"
  | "nodes"
  | "edges"
  | "outputs"
  | "parameters"
  | "interface"
  | "states"
  | "transitions";

export interface ElementChanges {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
}

/** Only kinds with at least one change are present. Parameters are keyed `node.parameter`. */
export type SemanticDiff = Partial<Record<DiffKind, ElementChanges>>;

const compare = (
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): ElementChanges => ({
  added: [...after.keys()].filter((id) => !before.has(id)).toSorted(),
  removed: [...before.keys()].filter((id) => !after.has(id)).toSorted(),
  changed: [...after]
    .filter(([id, value]) => before.has(id) && canonicalize(before.get(id)) !== canonicalize(value))
    .map(([id]) => id)
    .toSorted(),
});

const keyed = <A extends { readonly id: string }>(items: ReadonlyArray<A>) =>
  new Map(items.map((item) => [item.id, item] as const));

type Collections = Partial<Record<DiffKind, ReadonlyMap<string, unknown>>>;

const collections = (document: SystemDocument | ChartDocument): Collections => {
  if (document.format === "sw.system") {
    const system = semanticNormalize(document);
    return {
      clocks: keyed(system.clocks),
      nodes: keyed(system.nodes),
      edges: keyed(system.edges),
      outputs: keyed(system.outputs ?? []),
      parameters: new Map(
        system.nodes.flatMap((node) =>
          Object.entries(node.parameters).map(
            ([name, value]) => [`${node.id}.${name}`, value] as const,
          ),
        ),
      ),
    };
  }
  const chart = semanticNormalize(document);
  return {
    interface: new Map([
      ...chart.interface.inputs.map((variable) => [`input.${variable.id}`, variable] as const),
      ...chart.interface.outputs.map((variable) => [`output.${variable.id}`, variable] as const),
      ...chart.interface.events.map((event) => [`event.${event.id}`, event] as const),
    ]),
    states: keyed(chart.states),
    transitions: keyed(chart.transitions),
  };
};

export function semanticDiff(before: SystemDocument, after: SystemDocument): SemanticDiff;
export function semanticDiff(before: ChartDocument, after: ChartDocument): SemanticDiff;
export function semanticDiff(
  before: SystemDocument | ChartDocument,
  after: SystemDocument | ChartDocument,
): SemanticDiff {
  const left = collections(before);
  const right = collections(after);
  const diff: SemanticDiff = {};
  for (const kind of Object.keys(right) as Array<DiffKind>) {
    const changes = compare(left[kind] ?? new Map(), right[kind]!);
    if (changes.added.length + changes.removed.length + changes.changed.length > 0)
      diff[kind] = changes;
  }
  return diff;
}
