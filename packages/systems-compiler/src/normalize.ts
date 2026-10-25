import type { ChartDocument, SystemDocument } from "@t3tools/systems-model/documents";

import { BLOCK_SEMANTICS } from "./semantics.ts";

/**
 * Semantic normal form (RFC-001 §3.2): defaults inserted, meaning-free collections sorted
 * by id, ordered arrays (entry, exit, actions) kept. Titles are display labels and are
 * dropped, so the digest moves only when behavior can.
 */

const byId = <A extends { readonly id: string }>(items: ReadonlyArray<A>): Array<A> =>
  items.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const withoutTitle = <A extends { readonly title?: string }>({ title: _title, ...rest }: A) => rest;

/** Node parameters with the block's semantic defaults filled in. */
export const nodeParameters = (node: SystemDocument["nodes"][number]) => ({
  ...BLOCK_SEMANTICS[node.type]?.defaults,
  ...node.parameters,
});

export function semanticNormalize(document: SystemDocument): SystemDocument;
export function semanticNormalize(document: ChartDocument): ChartDocument;
export function semanticNormalize(
  document: SystemDocument | ChartDocument,
): SystemDocument | ChartDocument {
  if (document.format === "sw.system")
    return {
      ...withoutTitle(document),
      clocks: byId(document.clocks),
      nodes: byId(document.nodes).map((node) => ({ ...node, parameters: nodeParameters(node) })),
      edges: byId(document.edges),
      outputs: byId(document.outputs ?? []),
    };
  return {
    ...withoutTitle(document),
    interface: {
      inputs: byId(document.interface.inputs),
      outputs: byId(document.interface.outputs),
      events: byId(document.interface.events),
    },
    states: byId(document.states).map((state) => ({
      ...state,
      entry: state.entry ?? [],
      exit: state.exit ?? [],
    })),
    transitions: byId(document.transitions).map((transition) => ({
      ...transition,
      actions: transition.actions ?? [],
    })),
  };
}
